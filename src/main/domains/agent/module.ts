/**
 * agent 模块：生命周期与依赖。
 *
 * 对外只暴露 `agent` 一个 Domain；sessions / skills / models / tools /
 * prompts / themes / thinking / extensions / context 都是该服务的 resource。
 */

import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { ToolSurface } from './tools.ts';
import type { BrowserCapability } from '../browser/capability.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import type { SettingsManager } from '@earendil-works/pi-coding-agent';
import type { PiEventFrame } from '../../../shared/types.ts';
import { CallFailure } from '../../contract.ts';
import { createLog } from '../../log.ts';
import type { DialogView } from '../shell/domains.ts';
import type { PluginManager } from '../../plugin/manager.ts';
import { AgentApp } from './runtime/agent-app.ts';
import {
  SessionAgents,
  type SessionAgentInput,
} from './runtime/session-agents.ts';
import { SessionAgent } from './runtime/session-agent.ts';
import { PiPackageService } from './runtime/package-service.ts';
import { createAgentToolsExtension } from './runtime/tools-extension.ts';
import { AgentContext } from './context.ts';
import {
  createExtensionsState,
  createModelsState,
  createPromptsState,
  createSkillsState,
  createThemesState,
  createThinkingState,
  defineExtensionsResource,
  defineModelsResources,
  definePromptsResource,
  defineSessionsResources,
  defineSkillsResource,
  defineThemesResource,
  defineContextResources,
  defineToolsResource,
  reduceSessionFrame,
  sessionEntryOf,
  type SessionsPort,
  type ExtensionsState,
  type ModelsState,
  type ModelResources,
  type PromptsState,
  type SessionsState,
  type SkillsState,
  type ThemesState,
  type ThinkingState,
} from './domains.ts';

export class AgentModule implements DomainModule {
  readonly id = 'agent';
  readonly dependencies = ['workspace', 'browser', 'plugin'] as const;

  private readonly sessionsByWorkspace = new Map<string, SessionsState>();
  private sessionResources: {
    ensure: (workspaceId: string) => void;
    remove: (workspaceId: string) => void;
    publish: (workspaceId: string, key?: string) => void;
    event: (
      workspaceId: string,
      key: string,
      name: string,
      data: unknown,
    ) => void;
    stateOf: (workspaceId: string) => SessionsState;
    rekey: (workspaceId: string, from: string, to: string) => void;
  } | null = null;
  private readonly agentKeys = new Map<SessionAgent, string>();
  private readonly registeredWorkspaces = new Set<string>();
  private readonly models: ModelsState = createModelsState();
  private modelResources: ModelResources | null = null;
  private readonly skills: SkillsState = createSkillsState();
  private readonly prompts: PromptsState = createPromptsState();
  private readonly themes: ThemesState = createThemesState();
  private readonly thinking: ThinkingState = createThinkingState();
  private readonly extensions: ExtensionsState = createExtensionsState();
  private registry: DomainRegistry | null = null;
  private off: (() => void) | null = null;
  private offDialogs: (() => void) | null = null;
  private offPlugins: (() => void) | null = null;
  private pluginReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handledDialogs = new Set<string>();
  private readonly agents: SessionAgents;
  private readonly contexts = new Map<string, AgentContext>();
  private contextResources: {
    ensure: (workspaceId: string) => void;
    remove: (workspaceId: string) => void;
  } | null = null;
  private app: AgentApp | null = null;
  private currentWorkspaceId: string | null = null;
  private packages: PiPackageService | null = null;

  constructor(
    private readonly tools: ToolSurface,
    private readonly storage: StorageLayout,
    private readonly browser: BrowserCapability,
    private readonly plugins?: PluginManager,
  ) {
    this.agents = new SessionAgents((input) => this.bootstrapSession(input));
  }

  /** 当前工作区的活动会话 agent（App 级视图 / 设置用）。 */
  private host(): SessionAgent | null {
    const workspaceId = this.currentWorkspaceId;
    if (!workspaceId) return null;
    const key = this.sessionResources?.stateOf(workspaceId).current ?? null;
    return key ? this.agents.get(workspaceId, key) : null;
  }

  private workspaceMeta(
    workspaceId: string,
  ): { id: string; path: string } | null {
    const snapshot = this.registry?.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { workspaces?: Array<{ id: string; path: string }> } | null;
    return (
      snapshot?.workspaces?.find((item) => item.id === workspaceId) ?? null
    );
  }

  private async ensureSessionAgent(
    workspaceId: string,
    input: { sessionFile?: string; draftKey?: string },
  ): Promise<SessionAgent> {
    const meta = this.workspaceMeta(workspaceId);
    if (!meta) {
      throw new CallFailure('not_found', `工作区不存在：${workspaceId}`);
    }
    return this.agents.ensure({
      workspaceId,
      path: meta.path,
      ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
      ...(input.draftKey ? { draftKey: input.draftKey } : {}),
    });
  }

  private sessionPort(): SessionsPort {
    return {
      workspacePath: (workspaceId) =>
        this.workspaceMeta(workspaceId)?.path ?? null,
      listItems: async (workspaceId) => {
        const meta = this.workspaceMeta(workspaceId);
        const app = this.app;
        if (!meta || !app) return [];
        return app.listSessions(workspaceId, meta.path).catch(() => []);
      },
      agentOf: (workspaceId, key) => this.agents.get(workspaceId, key),
      ensureAgent: (workspaceId, input) =>
        this.ensureSessionAgent(workspaceId, input),
      disposeAgent: (workspaceId, key) => this.agents.dispose(workspaceId, key),
    };
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.sessionResources = defineSessionsResources(
      registry,
      this.sessionsByWorkspace,
      this.sessionPort(),
      this.thinking,
      (workspaceId, key) => this.agents.get(workspaceId, key),
    );
    this.modelResources = defineModelsResources(
      registry,
      this.models,
      () => this.host(),
      this.browser,
    );
    defineSkillsResource(registry, this.skills, () => this.host());
    defineToolsResource(registry, this.tools);
    definePromptsResource(registry, this.prompts, () => this.host());
    defineThemesResource(registry, this.themes, () => this.host());
    defineExtensionsResource(
      registry,
      this.extensions,
      () => this.host(),
      () => this.packages,
    );
    this.contextResources = defineContextResources(registry, this.contexts);
  }

  async start(): Promise<void> {
    const registry = this.registry;
    if (!registry) return;
    const snapshot = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { id?: string; path?: string } | null } | null;
    const current = snapshot?.current;
    this.app = await AgentApp.create({
      storage: this.storage,
      extensionFactories: [createAgentToolsExtension(this.tools, this.browser)],
      additionalSkillPaths: () => this.plugins?.skillPaths() ?? [],
      skillOwner: (source) => this.plugins?.skillOwner(source) ?? null,
    });
    this.app.onChanged = () => {
      this.refreshAppModels();
      for (const [, agents] of this.agents.entries()) {
        for (const agent of agents) {
          void agent.rebuildForModelChange().catch(() => undefined);
        }
      }
    };
    if (current?.id && current.path) {
      this.currentWorkspaceId = current.id;
      this.packages = new PiPackageService({
        settingsManager: () => this.currentSettingsManager(),
        cwd: () => this.currentWorkspacePath(),
        agentDir: () => this.storage.dataRoot,
        onChanged: () => this.reloadAfterPackages(),
      });
      this.refreshAppModels();
      this.syncSkills();
      await this.syncSessionResources();
      await this.ensureCurrentSession(current.id);
      // 会话创建时 pi 才装载技能；创建完成后再同步一次清单。
      this.syncSkills();
    }
    this.offDialogs = registry.onUpdate((update) => {
      if (
        update.domain !== 'shell' ||
        update.type !== 'snapshot' ||
        !update.resource.endsWith('/dialogs')
      ) {
        return;
      }
      this.handleDialogUpdate(update.resource.slice(0, -'/dialogs'.length));
    });
    this.offPlugins = registry.onUpdate((update) => {
      if (
        update.domain !== 'plugin' ||
        update.resource !== 'installed' ||
        update.type !== 'snapshot'
      ) {
        return;
      }
      this.skills.sources = this.plugins?.skillSources() ?? [];
      if (this.pluginReloadTimer) clearTimeout(this.pluginReloadTimer);
      this.pluginReloadTimer = setTimeout(() => {
        this.pluginReloadTimer = null;
        void this.host()
          ?.reloadResources()
          .then(() => this.syncSkills())
          .catch((error) => console.warn('[agent] skill reload failed', error));
      }, 150);
    });
    this.off = registry.onUpdate((update) => {
      if (
        update.domain !== 'workspace' ||
        update.resource !== 'registry' ||
        update.type !== 'snapshot'
      ) {
        return;
      }
      const current = (update.data as { current: WorkspaceMeta | null })
        .current;
      if (!current?.id || !current.path) return;
      void this.switchWorkspace(current.id);
    });
  }

  private currentWorkspacePath(): string {
    const workspaceId = this.currentWorkspaceId;
    return workspaceId ? (this.workspaceMeta(workspaceId)?.path ?? '') : '';
  }

  private currentSettingsManager(): SettingsManager | null {
    const workspaceId = this.currentWorkspaceId;
    return workspaceId && this.app
      ? this.app.settingsManagerFor(workspaceId)
      : null;
  }

  private async bootstrapSession(
    input: SessionAgentInput,
  ): Promise<SessionAgent> {
    const app = this.app;
    if (!app) throw new Error('agent app 未初始化');
    const { workspaceId, path, sessionFile, draftKey } = input;
    const agent = await SessionAgent.bootstrap({
      app,
      storage: this.storage,
      workspacePath: path,
      workspaceId,
      resourceRoots: () => this.tools.resourceRoots(),
      ...(sessionFile ? { sessionFile } : {}),
      ...(draftKey ? { draftKey } : {}),
      sendEvent: (frame) => this.onSessionFrame(agent, frame),
      ui: {
        onDialogRequest: (request) => {
          void this.dispatchShell(workspaceId, 'dialogs', 'open', {
            id: request.id,
            dialogType: request.dialogType,
            title: request.title,
            ...(request.message ? { message: request.message } : {}),
            ...(request.options ? { options: request.options } : {}),
            ...(request.placeholder
              ? { placeholder: request.placeholder }
              : {}),
            ...(request.prefill ? { prefill: request.prefill } : {}),
            ...(request.secret ? { secret: true } : {}),
          });
        },
        onDialogResolved: (id) => {
          void this.dispatchShell(workspaceId, 'dialogs', 'dismiss', { id });
        },
        onNotify: (message, level, source) => {
          void this.dispatchShell(workspaceId, 'notices', 'notify', {
            message,
            level,
            source,
          });
        },
      },
    });
    this.agentKeys.set(agent, agent.sessionKey);
    return agent;
  }

  private onSessionFrame(agent: SessionAgent, frame: PiEventFrame): void {
    const registry = this.registry;
    const workspaceId = agent.workspaceId;
    const state = this.sessionsByWorkspace.get(workspaceId);
    if (!registry || !state) return;
    const previous = this.agentKeys.get(agent);
    const key = agent.sessionKey;
    if (previous && previous !== key) {
      this.agents.rekey(workspaceId, previous, key);
      this.sessionResources?.rekey(workspaceId, previous, key);
    }
    this.agentKeys.set(agent, key);
    const entry = sessionEntryOf(state, key);
    const changed = reduceSessionFrame(entry, frame, agent, () =>
      this.sessionResources?.publish(workspaceId, key),
    );
    if (changed) {
      this.sessionResources?.publish(
        workspaceId,
        state.current === key ? key : undefined,
      );
    }
  }

  private async switchWorkspace(workspaceId: string): Promise<void> {
    this.currentWorkspaceId = workspaceId;
    this.refreshAppModels();
    this.syncSkills();
    await this.syncSessionResources();
    await this.ensureCurrentSession(workspaceId);
    this.syncSkills();
  }

  /** 当前工作区还没有活动会话时，建一个草稿会话供助手使用。 */
  private async ensureCurrentSession(workspaceId: string): Promise<void> {
    const state = this.sessionResources?.stateOf(workspaceId);
    const registry = this.registry;
    if (!state || !registry || state.current) return;
    await registry.dispatchCommand(
      { domain: 'agent', resource: `${workspaceId}/sessions` },
      'new',
      {},
      {
        origin: { type: 'service', id: 'agent' },
        changed: (ref, type) => registry.changed(ref, type),
        log: createLog('agent'),
      },
    );
  }

  /** 每个已登记工作区一份 `<wsId>/sessions`；会话按需创建。 */
  private async syncSessionResources(): Promise<void> {
    const registry = this.registry;
    const resources = this.sessionResources;
    if (!registry || !resources) return;
    const state = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as {
      current?: { id?: string } | null;
      workspaces?: Array<{ id: string; path: string }>;
    } | null;
    const workspaces = state?.workspaces ?? [];
    const known = new Set(workspaces.map((item) => item.id));
    for (const workspaceId of Array.from(this.registeredWorkspaces)) {
      if (known.has(workspaceId)) continue;
      this.registeredWorkspaces.delete(workspaceId);
      void this.agents.disposeWorkspace(workspaceId);
      resources.remove(workspaceId);
      this.contextResources?.remove(workspaceId);
    }
    for (const meta of workspaces) {
      this.registeredWorkspaces.add(meta.id);
      resources.ensure(meta.id);
      const sessions = resources.stateOf(meta.id);
      sessions.items = await this.sessionPort().listItems(meta.id);
      this.contextResources?.ensure(meta.id);
      const context = this.contexts.get(meta.id);
      if (context && context.snapshot().cwd !== meta.path) {
        context.setWorkspace(meta.path);
      }
    }
    resources.publish(state?.current?.id ?? '');
  }

  private refreshAppModels(): void {
    const app = this.app;
    if (!app) return;
    const view = app.getModelsView() as {
      providers: ModelsState['providers'];
      catalog: ModelsState['models'];
      config: ModelsState['config'];
    };
    this.models.providers = view.providers;
    this.models.models = view.catalog;
    this.models.config = view.config;
    this.modelResources?.sync();
  }

  private async reloadAfterPackages(): Promise<void> {
    const host = this.host();
    const registry = this.registry;
    if (!host || !registry) return;
    await host.reloadResources();
    const loaded = host.getLoadedResources();
    this.extensions.list = loaded.extensions.map((extension) => ({
      id: extension.path,
      source: extension.path,
    }));
    this.extensions.errors = loaded.errors.map((error) => error.message);
    this.extensions.configured = this.packages?.listConfigured() ?? [];
    registry.define('agent').resource('extensions').publish();
    this.syncSkills();
  }

  private syncSkills(): void {
    const app = this.app;
    if (!app) return;
    this.skills.catalog = app.skills.getSkillInfos().map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
      ...(skill.path ? { path: skill.path } : {}),
    }));
    this.skills.sources = this.plugins?.skillSources() ?? [];
    this.registry?.define('agent').resource('skills').publish();
  }

  private async dispatchShell(
    workspaceId: string,
    resource: 'dialogs' | 'notices',
    action: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const registry = this.registry;
    if (!registry || !workspaceId) return;
    const result = await registry.dispatchCommand(
      { domain: 'shell', resource: `${workspaceId}/${resource}` },
      action,
      input,
      {
        origin: { type: 'service', id: 'agent' },
        changed: (ref, type) => registry.changed(ref, type),
        log: createLog('agent'),
      },
    );
    if (!result.ok) {
      console.warn(`[agent] shell/${resource}/${action} failed`, result.error);
    }
  }

  private handleDialogUpdate(workspaceId: string): void {
    const registry = this.registry;
    if (!registry || !workspaceId) return;
    const key = this.sessionResources?.stateOf(workspaceId).current ?? null;
    const host = key ? this.agents.get(workspaceId, key) : null;
    if (!host) return;
    const dialogs = registry.snapshot({
      domain: 'shell',
      resource: `${workspaceId}/dialogs`,
    }) as DialogView[] | null;
    for (const dialog of dialogs ?? []) {
      if (
        dialog.status === 'open' ||
        this.handledDialogs.has(`${workspaceId}:${dialog.id}`)
      ) {
        continue;
      }
      this.handledDialogs.add(`${workspaceId}:${dialog.id}`);
      const response = dialog.response;
      const value =
        typeof response?.value === 'string' ? { value: response.value } : {};
      const confirmed =
        typeof response?.value === 'boolean'
          ? { confirmed: response.value }
          : response?.confirmed === undefined
            ? {}
            : { confirmed: response.confirmed };
      host.handleDialogResponse({
        id: dialog.id,
        ...value,
        ...confirmed,
        ...(dialog.status === 'cancelled' ? { cancelled: true } : {}),
      });
    }
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.offPlugins?.();
    this.offPlugins = null;
    if (this.pluginReloadTimer) {
      clearTimeout(this.pluginReloadTimer);
      this.pluginReloadTimer = null;
    }
    this.offDialogs?.();
    this.offDialogs = null;
    this.handledDialogs.clear();
    for (const workspaceId of Array.from(this.sessionsByWorkspace.keys())) {
      this.sessionResources?.remove(workspaceId);
    }
    this.sessionResources = null;
    this.sessionsByWorkspace.clear();
    this.models.providers = [];
    this.models.models = [];
    this.models.config = { providers: {} };
    this.modelResources = null;
    this.skills.active = new Set();
    this.skills.disabled = new Set();
    this.skills.catalog = [];
    this.prompts.prompts = [];
    this.themes.themes = [];
    this.thinking.level = null;
    this.thinking.levels = [];
    this.extensions.list = [];
    this.extensions.errors = [];
    for (const workspaceId of Array.from(this.contexts.keys())) {
      this.contextResources?.remove(workspaceId);
    }
    this.contexts.clear();
    this.contextResources = null;
    void this.agents.disposeAll();
    this.currentWorkspaceId = null;
    this.app = null;
    this.registry = null;
  }
}
