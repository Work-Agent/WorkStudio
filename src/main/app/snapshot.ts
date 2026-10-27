/**
 * AppSnapshot 构建。
 *
 * 从各作用域服务拼出快照。
 */

import { existsSync } from 'node:fs';
import type {
  AppSnapshot,
  AppSlice,
  ScopeEpochs,
  SessionSlice,
  WorkspaceMeta,
  WorkspaceSlice,
  WorkspaceUiSlice,
} from '../../shared/app';
import type { LayoutSnapshot } from '../../shared/types';
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

export interface SnapshotDeps {
  agent: AgentHost;
  sessions: SessionAdapter;
  lists: ListService;
  viewHost: ViewHost;
  uiState: UiStateService;
  registry: PluginHost;
  pluginService: PluginService;
  workspacePath: string;
  resourceMapVersion: () => string;
  layout: () => LayoutSnapshot | null;
}

function emptyResources() {
  return {
    extensions: [],
    skills: [],
    packages: [],
    diagnostics: [],
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

  const app: AppSlice = {
    models: {
      providers: [],
      models: deps.agent.getModels(),
      defaultModel: null,
    },
    credentials: [],
    plugins: deps.registry.pluginInfoList(),
    pluginSources: deps.pluginService.list().map((entry) => ({
      source: entry.source,
      type: entry.type === 'local' ? 'local' : 'zip',
      ...(entry.name ? { label: entry.name } : {}),
    })),
    resources: emptyResources(),
    settings: { values: settings.global as Record<string, unknown> },
  };

  const workspace: WorkspaceSlice = {
    meta: workspaceMeta(deps.workspacePath),
    settings: {
      project: settings.project as Record<string, unknown>,
      effective: settings.effective as Record<string, unknown>,
    },
    resources: {
      ...emptyResources(),
      resourceMap: {
        ref: deps.workspacePath,
        version: deps.resourceMapVersion(),
      },
      policy: {
        enabledExtensions: [],
        disabledExtensions: [],
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

  const session: SessionSlice = {
    meta: currentSession,
    status: agentSnapshot.isStreaming
      ? 'streaming'
      : agentSnapshot.isCompacting
        ? 'compacting'
        : 'idle',
    streaming: null,
    queue: {
      steering: agentSnapshot.pendingMessageCount,
      followUp: 0,
    },
    messages: [],
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
