/**
 * agent domain：拥有 AgentHost / Sessions / Skills / 模型配置 / 浏览器自动化。
 *
 * App 不再持有 agentHost、sessionsService、skills、packages、modelStore、
 * piSettings、automation；这些全部由本 domain 初始化和发布。
 */

import { join } from 'node:path';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { LoadedResourcesView } from '../../../shared/types.ts';
import {
  readWorkspacePolicy,
  writeWorkspacePolicy,
} from '../../runtime/storage/preferences.ts';
import type { StoragePaths } from '../../runtime/storage/storage-paths.ts';
import { AgentHost } from '../../agent/agent-host.ts';
import { PiPackageService } from '../../agent/package-service.ts';
import {
  ModelConfigStore,
  SettingsService as PiSettingsService,
} from '../../agent/config-service.ts';
import { AppSpaceSettingsStorage } from '../../agent/settings-storage.ts';
import { BrowserAutomation } from '../workspace/browser/automation.ts';
import { SkillsManager } from '../../agent/harness/skills.ts';
import { SessionsService } from '../../agent/sessions/service.ts';
import type { SessionsActive } from './sessions.ts';
import type { DomainModule, DomainRegistry } from '../../runtime/domains.ts';
import { defineSessionsDomain } from './sessions.ts';
import { defineModelsDomain } from './models.ts';
import { defineSkillsDomain } from './skills.ts';
import { defineThinkingDomain } from './thinking.ts';
import { defineExtensionsDomain } from './extensions.ts';
import { defineToolsDomain } from './tools.ts';
import { definePromptsDomain } from './prompts.ts';
import { defineThemesDomain } from './themes.ts';
import type { WorkspaceModule } from '../workspace/module.ts';
import type { Dialogs, Notices } from '../shell/dialogs.ts';
import type { SystemActions, WindowManager } from '../shell/native.ts';
import type { Views } from '../shell/views.ts';

export interface AgentDomainOptions {
  current(): WorkspaceMeta | null;
  storage: StoragePaths;
  workspace: WorkspaceModule;
  views: Views;
  windows: WindowManager;
  actions: SystemActions;
  dialogs: Dialogs;
  notices: Notices;
  openWeb(url: string, title?: string): Promise<{ id: string }>;
  openPlugin(pluginId: string): Promise<{ id: string }>;
  onSettingsChanged(): void;
  onListsChanged(): void;
}

export class AgentDomain implements DomainModule {
  readonly dependencies = ['shell', 'workspace'] as const;
  readonly id = 'agent';

  private readonly options: AgentDomainOptions;
  private host: AgentHost | null = null;
  private sessionsService: SessionsService | null = null;
  private skills: SkillsManager | null = null;
  private packages: PiPackageService | null = null;
  private modelStore: ModelConfigStore | null = null;
  private piSettings: PiSettingsService | null = null;
  private automation: BrowserAutomation | null = null;
  private init: Promise<void> | null = null;
  private workspaceId: string | null = null;
  private registry: DomainRegistry | null = null;

  constructor(options: AgentDomainOptions) {
    this.options = options;
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    defineSessionsDomain(registry, {
      ensure: () => this.ensure(),
      current: () => this.sessionsService?.current ?? null,
      list: () => this.sessionsService?.list ?? [],
      commands: () => this.sessionsService?.commands() ?? [],
      active: () => this.sessionsActive(),
      task: () => this.sessionsService?.task ?? null,
      opened: () => this.sessionsService?.opened ?? [],
      closeTabs: (paths) => this.sessionsService?.closeTabs(paths),
      newSession: () => this.sessionsService!.newSession(),
      open: (sessionId) => this.sessionsService!.openSession(sessionId),
      prompt: (input) => this.sessionsService!.prompt(input),
      steer: (text) => this.sessionsService!.steer(text),
      followUp: (text) => this.sessionsService!.followUp(text),
      abort: () => this.sessionsService!.abort(),
      compact: (instructions) => this.sessionsService!.compact(instructions),
      retry: (confirmed) => this.sessionsService!.retry(confirmed),
      fork: async (entryId, position, sessionId) => {
        const sessions = this.sessionsService!;
        if (sessionId && sessionId !== sessions.current?.sessionFile) {
          await sessions.openSession(encodeURIComponent(sessionId));
        }
        return sessions.fork(entryId, position);
      },
      rename: (name, sessionId) => {
        const file = sessionId ?? this.sessionsService?.current?.sessionFile;
        if (!this.sessionsService || !file)
          throw new Error('no active session');
        this.sessionsService.rename(encodeURIComponent(file), name);
      },
      deleteActive: async (sessionId) => {
        const file = sessionId ?? this.sessionsService?.current?.sessionFile;
        if (!this.sessionsService || !file)
          throw new Error('no active session');
        await this.sessionsService.deleteSession(encodeURIComponent(file));
      },
      setModel: (provider, modelId) =>
        this.sessionsService!.setModel(provider, modelId),
      refresh: () => this.sessionsService!.refresh(),
    });

    defineModelsDomain(registry, {
      ensure: () => this.ensure(),
      available: () => this.sessionsService?.models() ?? [],
      config: () => this.modelsView(),
      login: async (input) => {
        await this.ensure();
        await this.host!.loginProvider(input);
      },
      logout: async (providerId) => {
        await this.ensure();
        await this.host!.logoutProvider(providerId);
      },
      saveProvider: async (providerId, config) => {
        await this.ensure();
        await this.modelStore!.saveProvider(providerId, config as never);
        await this.host!.rebuildForModelChange();
      },
      deleteProvider: async (providerId) => {
        await this.ensure();
        await this.modelStore!.deleteProvider(providerId);
        await this.host!.rebuildForModelChange();
      },
      saveModel: async (providerId, model) => {
        await this.ensure();
        await this.modelStore!.saveModel(providerId, model as never);
        await this.host!.rebuildForModelChange();
      },
      deleteModel: async (providerId, modelId) => {
        await this.ensure();
        await this.modelStore!.deleteModel(providerId, modelId);
        await this.host!.rebuildForModelChange();
      },
    });

    defineSkillsDomain(registry, {
      ensure: () => this.ensure(),
      active: () => this.skills?.getActive() ?? [],
      setActive: (names) => {
        this.skills?.setActive(names);
        this.publishSkills();
        return this.skills?.getActive() ?? [];
      },
      catalog: () => this.skills?.getSkillInfos() ?? [],
      reload: async () => {
        await this.ensure();
        await this.host?.reloadResources();
      },
      diagnostics: () => this.skills?.getDiagnostics() ?? [],
      openPlugin: async (pluginId) => {
        await this.options.openPlugin(pluginId);
      },
      setEnabled: (name, enabled) => {
        const workspace = this.options.current();
        if (!workspace) return;
        const policy = readWorkspacePolicy(workspace.id);
        const disabled = new Set(policy.disabledSkills);
        if (enabled) disabled.delete(name);
        else disabled.add(name);
        writeWorkspacePolicy(workspace.id, {
          disabledSkills: [...disabled],
        });
        this.skills?.setDisabled([...disabled]);
      },
    });

    defineThinkingDomain(registry, {
      ensure: () => this.ensure(),
      state: () => {
        void this.ensure().catch(() => undefined);
        return {
          level: this.host?.getSnapshot().thinkingLevel ?? null,
          levels: this.host?.session.getAvailableThinkingLevels() ?? [],
        };
      },
      set: (level) => {
        this.sessionsService?.setThinking(level);
        this.publishSessions();
      },
    });

    defineExtensionsDomain(registry, {
      ensure: () => this.ensure(),
      resources: () => this.loadedResources(),
      reload: async () => {
        await this.ensure();
        await this.host?.reloadResources();
      },
    });
    defineToolsDomain(registry, {
      resources: () => this.loadedResources(),
    });
    definePromptsDomain(registry, {
      resources: () => this.loadedResources(),
    });
    defineThemesDomain(registry, {
      resources: () => this.loadedResources(),
    });
  }

  private loadedResources(): LoadedResourcesView {
    return (
      this.host?.getLoadedResources() ?? {
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
        errors: [],
      }
    );
  }

  private modelsView(): unknown {
    const config = this.modelStore?.readView() ?? { providers: {} };
    return {
      providers:
        this.host?.getProviderCatalog(Object.keys(config.providers)) ?? [],
      catalog: this.host?.getModelCatalog() ?? [],
      config,
    };
  }

  private publishConfig(): void {
    const registry = this.registry;
    if (!registry) return;
    registry.define('models').resource('config').publish();
    this.publishSkills();
    registry.define('thinking').resource('current').publish();
    this.publishHarness();
  }

  private publishHarness(): void {
    const registry = this.registry;
    if (!registry) return;
    registry.define('extensions').resource('list').publish();
    registry.define('extensions').resource('errors').publish();
    registry.define('tools').resource('list').publish();
    registry.define('prompts').resource('list').publish();
    registry.define('themes').resource('list').publish();
  }

  private publishSkills(): void {
    const domain = this.registry?.define('skills');
    if (!domain) return;
    domain.resource('active').publish();
    domain.resource('catalog').publish();
  }

  stop(): void {
    this.sessionsService = null;
    this.host = null;
    this.skills = null;
    this.packages = null;
    this.modelStore = null;
    this.piSettings = null;
    this.automation = null;
    this.init = null;
    this.workspaceId = null;
  }

  hostRef(): AgentHost | null {
    return this.host;
  }

  sessions(): SessionsService | null {
    return this.sessionsService;
  }

  skillsRef(): SkillsManager | null {
    return this.skills;
  }

  packagesRef(): PiPackageService | null {
    return this.packages;
  }

  modelsRef(): ModelConfigStore | null {
    return this.modelStore;
  }

  settingsRef(): PiSettingsService | null {
    return this.piSettings;
  }

  sessionsDir(): string {
    return this.host?.resolveSessionsDir() ?? '';
  }

  async ensure(): Promise<void> {
    const workspace = this.options.current();
    if (!workspace) throw new Error('no workspace');
    if (this.init && this.workspaceId === workspace.id) return this.init;

    if (this.host) {
      this.init = (async () => {
        await this.host!.setWorkspace(workspace.path);
        this.skills?.setDisabled(
          readWorkspacePolicy(workspace.id).disabledSkills,
        );
        await this.sessionsService?.reloadWorkspace();
        this.piSettings = this.settingsStoreFor(workspace.id);
        this.workspaceId = workspace.id;
        this.publishSessions();
        this.publishConfig();
        this.options.onSettingsChanged();
        this.options.onListsChanged();
      })().catch((error: unknown) => {
        this.init = null;
        throw error;
      });
      return this.init;
    }

    this.init = (async () => {
      const runtime = await this.options.workspace.ensure();
      const skills = new SkillsManager();
      skills.setDisabled(readWorkspacePolicy(workspace.id).disabledSkills);
      this.skills = skills;
      const host = await AgentHost.bootstrap(
        {
          ura: runtime.ura.ura,
          skills,
          registry: runtime.ura.host,
          getBrowserAutomation: () => this.browserAutomation(),
          sendEvent: (frame) => this.sessionsService?.receiveFrame(frame),
          onTurnFinished: () => {
            void this.sessionsService?.refresh();
            this.options.onListsChanged();
          },
          onWorkspaceChange: () => undefined,
          ui: {
            onDialogRequest: (request) =>
              this.options.dialogs.open(request as never),
            onDialogResolved: (id) => this.options.dialogs.resolve(id),
            onNotify: (message, level, source) =>
              this.options.notices.notify({
                message,
                level: level === 'warning' ? 'warn' : level,
                source,
              }),
          },
          openExternal: (url) => this.options.actions.openExternal(url),
        },
        workspace.path,
      );
      this.host = host;
      this.modelStore ??= new ModelConfigStore(this.options.storage.dataRoot);
      this.piSettings ??= this.settingsStoreFor(workspace.id);
      this.packages = new PiPackageService({
        settingsManager: () => this.host?.settingsManager ?? null,
        cwd: () => this.options.current()?.path ?? '',
        agentDir: () => this.options.storage.dataRoot,
        onChanged: () => this.host?.reloadResources(),
      });
      const sessions = new SessionsService(host);
      this.sessionsService = sessions;
      sessions.onChange(() => this.publishSessions());
      sessions.onStream(() => {
        this.domains().define('sessions').resource('active').publish();
      });
      await sessions.start();
      this.workspaceId = workspace.id;
      this.publishSessions();
      this.publishConfig();
      this.options.onSettingsChanged();
    })().catch((error: unknown) => {
      this.init = null;
      throw error;
    });
    return this.init;
  }

  private domains(): DomainRegistry {
    return this.registry!;
  }

  private browserAutomation(): BrowserAutomation | null {
    if (!this.options.current()) return null;
    this.automation ??= new BrowserAutomation({
      openWeb: (url) => {
        if (!this.options.current())
          return Promise.reject(new Error('no workspace'));
        return this.options.openWeb(url, url);
      },
      webContents: (viewId) =>
        this.options.views.nativeView(viewId)?.webContents ?? null,
      activeViewId: () => {
        const workspace = this.options.current();
        if (!workspace) return null;
        const window = this.options.windows.get(workspace.id);
        return (
          window?.tabs.list().find((view) => view.active && view.type === 'web')
            ?.id ?? null
        );
      },
    });
    return this.automation;
  }

  private settingsStoreFor(wsId: string): PiSettingsService {
    return new PiSettingsService(
      new AppSpaceSettingsStorage(
        this.options.storage.userSettingsFile,
        join(this.options.storage.workspaceBase(wsId), 'settings.json'),
      ),
    );
  }

  private sessionsActive(): SessionsActive {
    const sessions = this.sessionsService;
    const file = sessions?.current?.sessionFile;
    if (!sessions || !file) {
      return {
        sessionId: null,
        messages: [],
        stream: { streaming: false, text: '', thinking: '', tools: [] },
      };
    }
    const id = encodeURIComponent(file);
    return {
      sessionId: id,
      messages: sessions.messages(id),
      stream: sessions.stream(id),
    };
  }

  private publishSessions(): void {
    const registry = this.registry;
    if (!registry) return;
    const domain = registry.define('sessions');
    for (const name of [
      'current',
      'list',
      'commands',
      'active',
      'opened',
      'task',
    ]) {
      domain.resource(name).publish();
    }
    registry.define('models').resource('available').publish();
    registry.define('thinking').resource('current').publish();
  }
}
