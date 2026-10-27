/**
 * AppSnapshot 构建。
 *
 * 从各作用域服务拼出快照。
 */

import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type {
  AppSnapshot,
  AppSlice,
  ResourceSet,
  ScopeEpochs,
  SessionSlice,
  WorkspaceMeta,
  WorkspaceSlice,
  WorkspaceUiSlice,
} from '../../shared/app';
import type { LayoutSnapshot, ParsedMessage } from '../../shared/types';
import { readSessionMessages } from '../agent/session-index';
import type { AgentHost } from '../agent/agent-host';
import {
  getWorkspaceId,
  listWorkspaces,
  workspaceLabel,
} from '../agent/workspace';
import type { ViewHost } from '../capabilities/webview/host';
import type { SessionAdapter } from './session-adapter';
import type { ListService } from './lists/list-service';
import type { PluginService } from '../plugins/service';
import type { PluginHost } from '../plugins/host';
import type { UiStateService } from '../state/ui-state';
import type { ModelConfigStore } from '../agent/config-service';

export interface SnapshotDeps {
  agent: AgentHost;
  sessions: SessionAdapter;
  lists: ListService;
  viewHost: ViewHost;
  uiState: UiStateService;
  registry: PluginHost;
  pluginService: PluginService;
  modelConfig: ModelConfigStore;
  workspacePath: string;
  resourceMapVersion: () => string;
  layout: () => LayoutSnapshot | null;
}

function loadedResources(agent: AgentHost): ResourceSet {
  const loaded = agent.getLoadedResources();
  return {
    extensions: loaded.extensions.map((extension, index) => ({
      id: `loaded-${index}`,
      name: basename(extension.path),
      source: 'file' as const,
      path: extension.path,
      scope: 'app' as const,
      enabled: !extension.hidden,
      tools: extension.tools,
      commands: extension.commands,
    })),
    skills: loaded.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: 'app' as const,
      path: skill.path,
      manualOnly: false,
    })),
    packages: [],
    diagnostics: loaded.errors.map((error) => ({
      type: 'error' as const,
      message: error.message,
      path: error.path,
    })),
  };
}

function workspaceMeta(path: string): WorkspaceMeta {
  const found = listWorkspaces().find((item) => item.path === path);
  return {
    id: getWorkspaceId(path),
    path,
    name: workspaceLabel(path),
    createdAt: found?.createdAt ?? 0,
    lastOpenedAt: found?.lastOpenedAt ?? 0,
  };
}

let messageCachePath = '';
let messageCacheStamp = '';
let messageCache: ParsedMessage[] = [];

function sessionMessages(path: string | null): ParsedMessage[] {
  if (!path || !existsSync(path)) return [];
  try {
    const stat = statSync(path);
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (path !== messageCachePath || stamp !== messageCacheStamp) {
      messageCachePath = path;
      messageCacheStamp = stamp;
      messageCache = readSessionMessages(path);
    }
    return messageCache;
  } catch {
    return [];
  }
}

export async function buildAppSnapshot(
  deps: SnapshotDeps,
  epochs: ScopeEpochs,
): Promise<AppSnapshot> {
  const ui = deps.uiState.get();
  const settings = deps.agent.settingsService.view();
  const agentSnapshot = deps.agent.getSnapshot();
  const sessions = await deps.agent.listSessions();
  const currentSession = agentSnapshot.sessionFile
    ? (sessions.find((s) => s.path === agentSnapshot.sessionFile) ?? null)
    : null;

  const models = deps.agent.getModels();
  const providerIds = [...new Set(models.map((model) => model.provider))];
  const catalog = deps.agent.getProviderCatalog(
    Object.keys(deps.modelConfig.readView().providers),
  );
  const credentials = catalog.map((provider) => ({
    providerId: provider.id,
    configured: provider.configured,
    source:
      provider.authSource === 'environment'
        ? ('env' as const)
        : provider.configured
          ? ('keychain' as const)
          : ('none' as const),
  }));
  const resources = loadedResources(deps.agent);
  const app: AppSlice = {
    models: {
      providers: providerIds.map((id) => ({
        id,
        label: id,
        configured: true,
      })),
      models,
      defaultModel: agentSnapshot.modelId ?? null,
    },
    credentials,
    plugins: deps.registry.pluginInfoList(),
    pluginSources: deps.pluginService.list().map((entry) => ({
      source: entry.source,
      type: entry.type === 'local' ? 'local' : 'zip',
      ...(entry.name ? { label: entry.name } : {}),
    })),
    resources,
    settings: { values: settings.global as Record<string, unknown> },
  };

  const workspace: WorkspaceSlice = {
    meta: workspaceMeta(deps.workspacePath),
    settings: {
      project: settings.project as Record<string, unknown>,
      effective: settings.effective as Record<string, unknown>,
    },
    resources: {
      ...resources,
      resourceMap: {
        ref: deps.workspacePath,
        version: deps.resourceMapVersion(),
      },
      policy: {
        enabledExtensions: resources.extensions
          .filter((extension) => extension.enabled)
          .map((extension) => extension.path),
        disabledExtensions: resources.extensions
          .filter((extension) => !extension.enabled)
          .map((extension) => extension.path),
        defaultSkills: ui.selectedSkills,
      },
    },
    lists: await deps.lists.snapshot(epochs.workspace),
    views: deps.viewHost.list(),
    sessions,
  };

  const uiSlice: WorkspaceUiSlice = {
    theme: ui.theme,
    sidebar: {
      view: ui.sidebarView,
      domain: ui.sidebarDomain ?? null,
      collapsed: ui.sidebarCollapsed,
      group: ui.sidebarGroup ?? null,
      pinnedGroups: ui.pinnedGroups,
    },
    paneWidths: ui.paneWidths,
    assistant: {
      open: ui.aiOpen,
      floating: ui.aiFloating,
      inputExpanded: ui.inputExpanded,
    },
    openSessionPaths: ui.openPaths.filter((path) => existsSync(path)),
  };

  const sessionPath = agentSnapshot.sessionFile;
  const messages = sessionMessages(sessionPath);
  const session: SessionSlice = {
    meta: currentSession,
    status: agentSnapshot.isStreaming
      ? 'streaming'
      : agentSnapshot.isCompacting
        ? 'compacting'
        : 'idle',
    streaming: agentSnapshot.isStreaming
      ? { sessionPath: sessionPath ?? '', startedAt: 0 }
      : null,
    queue: {
      steering: agentSnapshot.pendingMessageCount,
      followUp: 0,
    },
    messages,
    usage: {
      input: currentSession?.tokens?.input ?? 0,
      output: currentSession?.tokens?.output ?? 0,
      total:
        (currentSession?.tokens?.input ?? 0) +
        (currentSession?.tokens?.output ?? 0),
    },
    context: {
      resourceMapVersion: deps.resourceMapVersion(),
      activeSkills: deps.sessions.getActiveSkills(),
      agentsFileVersion: null,
    },
    snapshot: agentSnapshot,
  };

  return {
    app,
    workspaces: listWorkspaces().map((item) => ({
      id: getWorkspaceId(item.path),
      path: item.path,
      name: workspaceLabel(item.path),
      createdAt: item.createdAt,
      lastOpenedAt: item.lastOpenedAt,
    })),
    workspace,
    ui: uiSlice,
    session,
    layout: deps.layout(),
    seq: deps.agent.currentSeq,
    workspaceEpoch: epochs.workspace,
    sessionEpoch: epochs.session,
  };
}
