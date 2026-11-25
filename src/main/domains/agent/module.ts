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
import { createLog } from '../../log.ts';
import { listSessions } from './runtime/session-list.ts';
import type { SessionMeta } from '../../../shared/types.ts';
import type { DialogView } from '../shell/domains.ts';
import type { PluginManager } from '../../plugin/manager.ts';
import { AgentHost } from './runtime/agent-host.ts';
import { PiPackageService } from './runtime/package-service.ts';
import { createAgentToolsExtension } from './runtime/tools-extension.ts';
import type { AgentContext } from './context.ts';
import {
  createExtensionsState,
  createModelsState,
  createPromptsState,
  createSessionsState,
  createSkillsState,
  createThemesState,
  createThinkingState,
  defineExtensionsResource,
  defineModelsResources,
  definePromptsResource,
  defineSessionsResources,
  defineSkillsResource,
  defineThemesResource,
  defineContextResource,
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

  private readonly sessions: SessionsState = createSessionsState();
  private sessionResources: {
    ensure: (workspaceId: string) => void;
    remove: (workspaceId: string) => void;
    publish: () => void;
    event: (name: string, data: unknown) => void;
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
  private host: AgentHost | null = null;
  private packages: PiPackageService | null = null;

  constructor(
    private readonly context: AgentContext,
    private readonly tools: ToolSurface,
    private readonly storage: StorageLayout,
    private readonly browser: BrowserCapability,
    private readonly plugins?: PluginManager,
  ) {}

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.sessionResources = defineSessionsResources(
      registry,
      this.sessions,
      this.context,
      this.thinking,
      () => this.host,
      (workspaceId) => this.idleSessions.get(workspaceId) ?? [],
    );
    this.modelResources = defineModelsResources(
      registry,
      this.models,
      () => this.host,
      this.browser,
    );
    defineSkillsResource(registry, this.skills, () => this.host);
    defineToolsResource(registry, this.tools);
    definePromptsResource(registry, this.prompts, () => this.host);
    defineThemesResource(registry, this.themes, () => this.host);
    defineExtensionsResource(
      registry,
      this.extensions,
      () => this.host,
      () => this.packages,
    );
    defineContextResource(registry, this.context);
    defineRuntimeResource(registry, () => this.host);
  }

  async start(): Promise<void> {
    const registry = this.registry;
    if (!registry) return;
    const snapshot = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { path?: string } | null } | null;
    const workspacePath = snapshot?.current?.path;
    if (workspacePath) {
      try {
        this.host = await AgentHost.bootstrap({
          storage: this.storage,
          workspacePath,
          extensionFactories: [
            createAgentToolsExtension(this.tools, this.browser),
          ],
          sendEvent: (frame) => {
            const agent = registry.define('agent');
            agent.resource('runtime').event('event', frame);
            this.sessionResources?.event('event', frame);
            if (
              reduceSessionFrame(this.sessions, frame, this.host, () =>
                this.sessionResources?.publish(),
              )
            ) {
              this.sessionResources?.publish();
            }
          },
          additionalSkillPaths: () => this.plugins?.skillPaths() ?? [],
          skillOwner: (source) => this.plugins?.skillOwner(source) ?? null,
          ui: {
            onDialogRequest: (request) => {
              void this.dispatchShell('dialogs', 'open', {
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
              void this.dispatchShell('dialogs', 'dismiss', { id });
            },
            onNotify: (message, level, source) => {
              void this.dispatchShell('notices', 'notify', {
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
        this.packages = new PiPackageService({
          settingsManager: () => this.host?.settingsManager ?? null,
          cwd: () => this.host?.getWorkspacePath() ?? workspacePath,
          agentDir: () => this.storage.dataRoot,
          onChanged: () => this.reloadAfterPackages(),
        });
      } catch (error) {
        this.host = null;
        this.packages = null;
        console.error('[agent] runtime bootstrap failed', error);
      }
    }
    applyWorkspace(this.context, registry);
    if (this.host) {
      this.models.providers = this.host.getProviderCatalog([]);
      this.models.models = this.host.getModelCatalog();
      this.modelResources?.sync();
      this.syncSkills();
      this.sessions.workspaceId =
        (snapshot as { current?: { id?: string } | null } | null)?.current
          ?.id ?? '';
      this.sessions.items = await this.host.listSessions().catch(() => []);
      this.sessions.messages = await this.host.getMessages().catch(() => []);
      this.sessions.commands = this.host.getCommands();
      this.sessions.currentId = this.host.getSnapshot().sessionId ?? null;
      await this.syncSessionResources();
    }
    this.offDialogs = registry.onUpdate((update) => {
      if (
        update.domain !== 'shell' ||
        update.type !== 'snapshot' ||
        !this.sessions.workspaceId ||
        update.resource !== `${this.sessions.workspaceId}/dialogs`
      ) {
        return;
      }
      this.handleDialogUpdate();
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
        void this.host
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
      applyWorkspace(this.context, registry, update.data);
      const current = (update.data as { current: WorkspaceMeta | null })
        .current;
      if (current?.path && this.host) {
        void this.host
          .setWorkspace(current.path)
          .then(() => this.refreshSessions())
          .catch((error: unknown) => {
            console.error('[agent] workspace rebind failed', error);
          });
      }
    });
  }

  private async refreshSessions(): Promise<void> {
    const host = this.host;
    const registry = this.registry;
    if (!host || !registry) return;
    const list = await host.listSessions().catch(() => []);
    const snapshot = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current?: { id?: string } | null } | null;
    this.sessions.workspaceId = snapshot?.current?.id ?? '';
    this.sessions.items = list;
    this.sessions.currentId = host.getSnapshot().sessionId ?? null;
    this.sessions.messages = await host.getMessages().catch(() => []);
    this.sessions.commands = host.getCommands();
    await this.syncSessionResources();
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
    for (const workspaceId of Array.from(this.idleSessions.keys())) {
      if (known.has(workspaceId)) continue;
      this.idleSessions.delete(workspaceId);
    }
    for (const workspaceId of Array.from(this.registeredWorkspaces)) {
      if (known.has(workspaceId)) continue;
      this.registeredWorkspaces.delete(workspaceId);
      resources.remove(workspaceId);
    }
    for (const meta of workspaces) {
      if (meta.id === this.sessions.workspaceId) {
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
    }
    resources.publish();
  }

  private async reloadAfterPackages(): Promise<void> {
    const host = this.host;
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
    const host = this.host;
    if (!host) return;
    this.skills.catalog = host
      .skillsRef()
      .getSkillInfos()
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
        ...(skill.path ? { path: skill.path } : {}),
      }));
    this.skills.sources = this.plugins?.skillSources() ?? [];
    this.registry?.define('agent').resource('skills').publish();
  }

  private async dispatchShell(
    resource: 'dialogs' | 'notices',
    action: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    const registry = this.registry;
    if (!registry) return;
    const workspaceId = this.sessions.workspaceId;
    if (!workspaceId) return;
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

  private handleDialogUpdate(): void {
    const host = this.host;
    const registry = this.registry;
    if (!host || !registry) return;
    if (!this.sessions.workspaceId) return;
    const dialogs = registry.snapshot({
      domain: 'shell',
      resource: `${this.sessions.workspaceId}/dialogs`,
    }) as DialogView[] | null;
    for (const dialog of dialogs ?? []) {
      if (dialog.status === 'open' || this.handledDialogs.has(dialog.id)) {
        continue;
      }
      this.handledDialogs.add(dialog.id);
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
    for (const id of this.sessions.sessions.keys()) {
      this.registry
        ?.define('agent')
        .remove(`${this.sessions.workspaceId}/session/${id}`);
    }
    for (const workspaceId of this.idleSessions.keys()) {
      this.sessionResources?.remove(workspaceId);
    }
    if (this.sessions.workspaceId) {
      this.sessionResources?.remove(this.sessions.workspaceId);
    }
    this.idleSessions.clear();
    this.sessionResources = null;
    this.sessions.sessions.clear();
    this.sessions.currentId = null;
    this.sessions.items = [];
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
    this.context.setWorkspace('');
    this.host?.dispose();
    this.host = null;
    this.registry = null;
  }
}

function applyWorkspace(
  context: AgentContext,
  registry: DomainRegistry,
  data?: unknown,
): void {
  const snapshot =
    data !== undefined
      ? (data as { current: WorkspaceMeta | null })
      : (registry.snapshot({
          domain: 'workspace',
          resource: 'registry',
        }) as { current: WorkspaceMeta | null } | null);
  context.setWorkspace(snapshot?.current?.path ?? '');
}
