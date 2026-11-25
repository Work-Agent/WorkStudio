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
import { CallFailure } from '../../contract.ts';
import { createLog } from '../../log.ts';
import { listSessions } from './runtime/session-list.ts';
import type { SessionMeta } from '../../../shared/types.ts';
import type { DialogView } from '../shell/domains.ts';
import type { PluginManager } from '../../plugin/manager.ts';
import { AgentApp } from './runtime/agent-app.ts';
import { AgentRuntimes } from './runtime/agent-runtimes.ts';
import { WorkspaceAgent } from './runtime/workspace-agent.ts';
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
  defineRuntimeResource,
  reduceSessionFrame,
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
    publish: (workspaceId?: string) => void;
    event: (workspaceId: string, name: string, data: unknown) => void;
    stateOf: (workspaceId: string) => SessionsState;
  } | null = null;
  private readonly idleSessions = new Map<string, SessionMeta[]>();
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
  private readonly runtimes: AgentRuntimes;
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
    this.runtimes = new AgentRuntimes((workspaceId, path) =>
      this.bootstrapAgent(workspaceId, path),
    );
  }

  /** 当前工作区的 agent runtime（App 级视图 / 设置用）。 */
  private host(): WorkspaceAgent | null {
    return this.currentWorkspaceId
      ? this.runtimes.get(this.currentWorkspaceId)
      : null;
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

  /** 按需创建某工作区的 runtime，并把会话投影刷新到该工作区状态。 */
  private async ensureRuntime(workspaceId: string): Promise<WorkspaceAgent> {
    const existing = this.runtimes.get(workspaceId);
    if (existing) return existing;
    const meta = this.workspaceMeta(workspaceId);
    if (!meta) {
      throw new CallFailure('not_found', `工作区不存在：${workspaceId}`);
    }
    const agent = await this.runtimes.ensure(workspaceId, meta.path);
    await this.refreshWorkspaceState(workspaceId, agent);
    return agent;
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.sessionResources = defineSessionsResources(
      registry,
      this.sessionsByWorkspace,
      this.thinking,
      (workspaceId) => this.runtimes.get(workspaceId),
      (workspaceId) => this.ensureRuntime(workspaceId),
      (workspaceId) => this.idleSessions.get(workspaceId) ?? [],
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
    defineRuntimeResource(registry, () => this.host());
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
      for (const [, agent] of this.runtimes.entries()) {
        void agent.rebuildForModelChange().catch(() => undefined);
      }
    };
    if (current?.id && current.path) {
      this.currentWorkspaceId = current.id;
      try {
        const agent = await this.runtimes.ensure(current.id, current.path);
        this.packages = new PiPackageService({
          settingsManager: () => this.host()?.settingsManager ?? null,
          cwd: () => this.host()?.getWorkspacePath() ?? current.path!,
          agentDir: () => this.storage.dataRoot,
          onChanged: () => this.reloadAfterPackages(),
        });
        this.refreshAppModels();
        this.syncSkills();
        await this.refreshWorkspaceState(current.id, agent);
        await this.syncSessionResources();
      } catch (error) {
        this.packages = null;
        console.error('[agent] runtime bootstrap failed', error);
      }
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
      void this.switchWorkspace(current.id, current.path);
    });
  }

  private async bootstrapAgent(
    workspaceId: string,
    workspacePath: string,
  ): Promise<WorkspaceAgent> {
    const app = this.app;
    if (!app) throw new Error('agent app 未初始化');
    return WorkspaceAgent.bootstrap({
      app,
      storage: this.storage,
      workspacePath,
      workspaceId,
      sendEvent: (frame) => {
        const registry = this.registry;
        if (!registry) return;
        registry.define('agent').resource('runtime').event('event', frame);
        this.sessionResources?.event(workspaceId, 'event', frame);
        const state = this.sessionsByWorkspace.get(workspaceId);
        if (!state) return;
        if (
          reduceSessionFrame(state, frame, this.runtimes.get(workspaceId), () =>
            this.sessionResources?.publish(workspaceId),
          )
        ) {
          this.sessionResources?.publish(workspaceId);
        }
      },
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
      onTurnFinished: () => {
        this.registry?.define('agent').resource('runtime').publish();
      },
    });
  }

  private async switchWorkspace(
    workspaceId: string,
    path: string,
  ): Promise<void> {
    this.currentWorkspaceId = workspaceId;
    try {
      const agent =
        this.runtimes.get(workspaceId) ??
        (await this.runtimes.ensure(workspaceId, path));
      await this.refreshWorkspaceState(workspaceId, agent);
      this.refreshAppModels();
      this.syncSkills();
    } catch (error) {
      console.error('[agent] workspace bootstrap failed', error);
    }
    await this.syncSessionResources();
  }

  private async refreshWorkspaceState(
    workspaceId: string,
    agent: WorkspaceAgent,
  ): Promise<void> {
    const state = this.sessionResources?.stateOf(workspaceId);
    if (!state) return;
    state.items = await agent.listSessions().catch(() => []);
    state.messages = await agent.getMessages().catch(() => []);
    state.commands = agent.getCommands();
  }

  /** 每个已登记工作区一份 `<wsId>/sessions`；非激活工作区只给只读投影。 */
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
    for (const [workspaceId] of this.runtimes.entries()) {
      if (known.has(workspaceId)) continue;
      void this.runtimes.dispose(workspaceId);
    }
    for (const workspaceId of Array.from(this.registeredWorkspaces)) {
      if (known.has(workspaceId)) continue;
      this.registeredWorkspaces.delete(workspaceId);
      resources.remove(workspaceId);
      this.contextResources?.remove(workspaceId);
    }
    for (const workspaceId of Array.from(this.idleSessions.keys())) {
      if (known.has(workspaceId)) continue;
      this.idleSessions.delete(workspaceId);
    }
    for (const meta of workspaces) {
      if (this.runtimes.get(meta.id)) {
        this.idleSessions.delete(meta.id);
        continue;
      }
      const items = await listSessions(
        meta.path,
        this.storage.sessionsDir(meta.id),
      ).catch(() => []);
      this.idleSessions.set(meta.id, items);
    }
    for (const meta of workspaces) {
      this.registeredWorkspaces.add(meta.id);
      resources.ensure(meta.id);
      this.contextResources?.ensure(meta.id);
      const context = this.contexts.get(meta.id);
      if (context && context.snapshot().cwd !== meta.path) {
        context.setWorkspace(meta.path);
      }
    }
    resources.publish();
  }

  private refreshAppModels(): void {
    const app = this.app;
    if (!app) return;
    this.models.providers = app.getProviderCatalog([]);
    this.models.models = app.getModelCatalog();
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
    const host = this.runtimes.get(workspaceId);
    const registry = this.registry;
    if (!host || !registry || !workspaceId) return;
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
    this.idleSessions.clear();
    this.sessionResources = null;
    this.sessionsByWorkspace.clear();
    this.models.providers = [];
    this.models.models = [];
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
    void this.runtimes.disposeAll();
    this.currentWorkspaceId = null;
    this.app = null;
    this.registry = null;
  }
}
