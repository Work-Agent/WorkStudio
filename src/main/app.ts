/**
 * app 组件：应用运行时 + IPC transport。
 *
 *   Pipeline     middleware / Domain 路由 / update 分发
 *   Dispatcher   sender → origin → Pipeline
 *   App          Domain / View / Pipeline / Dispatcher 的组合根与 IPC 生命周期
 *
 * App.start() 必须在 Electron ready 之后调用；进程生命周期、单实例锁、
 * whenReady、quit 等由 main 的 Bootstrap 负责。
 */

import {
  app as electronApp,
  ipcMain,
  nativeTheme,
  protocol,
  session,
} from 'electron';
import { join } from 'node:path';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import {
  getDataRoot,
  initDataRoot,
  setDataRoot,
} from './infrastructure/data-root.ts';
import { PiPackageService } from './modules/agent/package-service.ts';
import {
  ModelConfigStore,
  SettingsService as PiSettingsService,
  type SettingsViewResult,
} from './modules/agent/config-service.ts';
import { AppSpaceSettingsStorage } from './modules/agent/settings-storage.ts';
import { PluginService } from './modules/plugins/plugin-source.ts';
import { PluginCatalogService } from './modules/plugins/catalog.ts';
import { PluginsService } from './modules/plugins/plugins-service.ts';
import {
  getAgentDir,
  getWorkspaceBase,
  initAgentDir,
} from './modules/agent/workspace.ts';
import { AgentHost } from './modules/agent/agent-host.ts';
import { registerBrowserFeatures } from './modules/browser/features.ts';
import { settingsPages } from './modules/settings/registry.ts';
import { serveAppPages } from './runtime/app-pages.ts';
import { BUNDLED_GITHUB_TOKEN } from './modules/plugins/github.ts';
import {
  pluginCatalogFile,
  pluginCatalogUrlFile,
  pluginDataRoot,
  pluginsRoot,
  uraBindingsFile,
} from './infrastructure/paths.ts';
import {
  readUserPreferences,
  readWorkspacePolicy,
  writeBrowserAllowlist,
  writeUserPreferences,
  writeWorkspacePolicy,
} from './infrastructure/preferences.ts';
import { WorkspacesRepo } from './infrastructure/repo/workspaces.ts';
import { SkillsManager } from './modules/harness/skills.ts';
import {
  createListsRuntime,
  type ListsRuntime,
} from './modules/lists/index.ts';
import { ResourcesService } from './modules/resources/service.ts';
import { SessionsService } from './modules/sessions/service.ts';
import { UpdatesService } from './modules/updates/service.ts';
import { UpdateService } from './modules/updates/updater.ts';
import { createUraRuntime, type UraRuntime } from './modules/ura/index.ts';
import { uraRegistry } from './modules/ura/registry.ts';
import { PageSessions } from './modules/ura/page-sessions.ts';
import type { WorkspaceMeta } from '../shared/app.ts';
import type {
  ModelConfigView,
  ModelsConfigView,
  ProviderConfigView,
} from '../shared/types.ts';
import type { ListItem, ListSnapshot } from '../shared/lists.ts';
import { CH_BUS, CH_URA, CH_URA_WATCH } from '../shared/channels.ts';
import {
  normalizeAppearance,
  resolveAppearance,
  type AppearanceSettings,
  type AppearanceSnapshot,
} from '../shared/appearance.ts';
import { DomainRegistry } from './runtime/domains.ts';
import { Dispatcher } from './runtime/dispatcher.ts';
import { Pipeline } from './runtime/pipeline.ts';
import { Dialogs, Notices } from './runtime/dialogs.ts';
import {
  Scene,
  SystemActions,
  ThemeManager,
  WindowManager,
  WorkspaceWindow,
  type WindowOptions,
  type SceneOptions,
} from './runtime/native.ts';
import {
  defineListsDomain,
  defineNativeDomain,
  definePluginsDomain,
  defineResourcesDomain,
  defineSessionsDomain,
  defineSettingsDomain,
  defineUpdatesDomain,
  defineThemeDomain,
  defineWindowsDomain,
  defineWorkspacesDomain,
  type PluginSurface,
  type ResourcesRuntime,
  type SessionsActive,
  type SettingsStorageView,
} from './domains/index.ts';
import {
  applyLayoutUpdates,
  bindWindowDomains,
} from './runtime/window-bindings.ts';
import { installMenu } from './runtime/menu.ts';
import { IPC_CHANNELS } from './runtime/shared.ts';
import type { Middleware } from './runtime/shared.ts';
import { Views } from './runtime/views.ts';
import { AppViews } from './runtime/app-views.ts';
import { registerAppProviders } from './runtime/app-providers.ts';

export interface AppOptions {
  /** 启动时打开的工作区；之后用 openWorkspace 打开更多窗口。 */
  workspaceId?: string;
  url?: string;
  /** 内容视图 preload（app:// 资源页 / 浏览器页）。 */
  preloads?: {
    extension?: string;
    browser?: string;
    assistant?: string;
    overlay?: string;
    settings?: string;
  };
  /** renderer 页面地址（index / assistant / overlay）。 */
  rendererPage?: (
    page: 'index' | 'assistant' | 'overlay' | 'settings' | 'welcome',
  ) => string;
  window?: WindowOptions;
  scene?: SceneOptions;
  /** 交互捕获层 preload（透明 WebContentsView）。 */
  capturePreload?: string;
  /** Chromium remote debugging 端口；缺省读 WA_DEBUG_PORT。 */
  debugPort?: string;
}

export class App {
  readonly domains: DomainRegistry;
  readonly workspaceRepo: WorkspacesRepo;
  readonly windows: WindowManager;
  readonly views: Views;
  readonly theme: ThemeManager;
  readonly scene: Scene;
  readonly actions: SystemActions;
  readonly dialogs: Dialogs;
  readonly notices: Notices;
  readonly dispatcher: Dispatcher;

  private readonly options: AppOptions;
  private readonly pipeline: Pipeline;
  private readonly appViews: AppViews;
  private currentWorkspace: WorkspaceMeta | null = null;
  private uraRuntime: UraRuntime | null = null;
  private resourcesService: ResourcesService | null = null;
  private resourcesWorkspaceId: string | null = null;
  private resourcesInit: Promise<ResourcesRuntime> | null = null;
  private listsRuntime: ListsRuntime | null = null;
  private listsSnapshot: ListSnapshot | null = null;
  private listsRefresh: Promise<void> | null = null;
  private agentHost: AgentHost | null = null;
  private sessionsService: SessionsService | null = null;
  private skills: SkillsManager | null = null;
  private agentInit: Promise<void> | null = null;
  private agentWorkspaceId: string | null = null;
  private packages: PiPackageService | null = null;
  private modelStore: ModelConfigStore | null = null;
  private piSettings: PiSettingsService | null = null;
  private pluginService: PluginService | null = null;
  private pluginCatalog: PluginCatalogService | null = null;
  private plugins: PluginsService | null = null;
  private readonly updates: UpdatesService;
  private offLayout: (() => void) | null = null;
  private viewWatch: { close(): void } | null = null;
  private ipcAttached = false;
  private started = false;

  constructor(options: AppOptions = {}) {
    this.options = options;
    this.domains = new DomainRegistry();
    this.workspaceRepo = new WorkspacesRepo();
    this.theme = new ThemeManager();
    this.windows = new WindowManager(() => this.theme.read());
    this.views = new Views(this.domains, this.windows);
    this.appViews = new AppViews({
      views: this.views,
      options: this.options,
      started: () => this.started,
      currentWorkspace: () => this.currentWorkspace,
      ensureResources: () => this.ensureResources(),
      resources: () => this.resourcesService,
      ensureAgent: () => this.ensureAgent(),
    });
    this.views.onEmpty((window) => this.appViews.ensureWelcome(window));
    this.scene = new Scene(
      options.scene ?? { root: join(getDataRoot(), 'workspaces') },
    );
    this.actions = new SystemActions(this.windows);
    this.dialogs = new Dialogs(this.domains, (visible) =>
      this.setOverlayVisible(visible),
    );
    this.notices = new Notices(this.domains);
    this.updates = new UpdatesService(
      new UpdateService({
        token: () =>
          process.env['GITHUB_TOKEN'] ??
          readUserPreferences().githubToken ??
          BUNDLED_GITHUB_TOKEN,
      }),
    );
    this.updates.onChange(() => this.publishUpdates());

    defineThemeDomain(this.domains, this.theme, this.windows, (source) =>
      this.persistThemeSource(source),
    );
    defineWindowsDomain(this.domains, this.windows, this.actions, (wsId) =>
      this.openWorkspace(wsId),
    );
    defineNativeDomain(this.domains, this.actions);
    defineWorkspacesDomain(this.domains, this.workspaceRepo, {
      current: () => this.currentWorkspace,
      open: (id) => this.openWorkspace(id),
      close: (id) => this.closeWorkspace(id),
    });
    defineResourcesDomain(this.domains, {
      current: () => this.currentWorkspace,
      runtime: () => this.resourcesRuntime(),
      ensure: () => this.ensureResources(),
      changed: () => this.publishResources(),
      openView: (ref: string) => this.appViews.openResource(ref),
      openWeb: (url, title) => this.appViews.openWeb(url, title),
      openPageView: (ref) => this.appViews.openResourcePageView(ref),
      saveCopy: (pageId, content) =>
        this.appViews.savePageCopy(pageId, content),
      refresh: () => this.ensureResources().then(() => this.publishResources()),
    });
    defineSettingsDomain(this.domains, {
      pages: () => settingsPages(),
      open: (pageId) => this.appViews.openSettings(pageId),
      appearance: () => this.appearanceSnapshot(),
      setAppearance: (patch) => this.updateAppearance(patch),
      storage: () => this.settingsStorage(),
      openPath: (path) => this.actions.openPath(path),
      changeDataRoot: async () => {
        const path = await this.actions.pickDirectory(
          this.currentWorkspace?.id,
        );
        if (path) setDataRoot(path);
        return path ?? null;
      },
      changeSessionDir: async () => {
        const path = await this.actions.pickDirectory(
          this.currentWorkspace?.id,
        );
        if (!path) return null;
        this.piSettings?.setGlobal('sessionDir', path);
        await this.agentHost?.rebuildForWorkspace();
        this.publishSettings();
        return path;
      },
      reloadSkills: async () => {
        await this.ensureAgent();
        await this.agentHost?.reloadResources();
        this.publishSettings();
      },
      skillDiagnostics: () => this.skills?.getDiagnostics() ?? [],
      openPlugin: async (pluginId) => {
        await this.appViews.openPlugin(pluginId, 'settings');
      },
      resourceDiagnostics: () => ({
        ...uraRegistry.snapshot(),
        diagnostics: uraRegistry.diagnostics(),
      }),
      browser: () => {
        const workspace = this.currentWorkspace;
        return {
          allowlist: workspace
            ? readWorkspacePolicy(workspace.id).browser.allowlist
            : [],
        };
      },
      setBrowser: (allowlist) => {
        const workspace = this.currentWorkspace;
        if (workspace) writeBrowserAllowlist(workspace.id, allowlist);
        this.publishSettings();
        return { allowlist };
      },
      skills: () => this.skills?.getSkillInfos() ?? [],
      extensions: () => this.packages?.listConfigured() ?? [],
      installExtension: async (name) => {
        await this.ensureAgent();
        await this.packages?.install(name);
        this.publishSettings();
      },
      searchExtensions: async (input) => {
        await this.ensureAgent();
        return (
          this.packages?.searchCatalog(input) ?? { packages: [], total: 0 }
        );
      },
      removeExtension: async (source, scope) => {
        await this.ensureAgent();
        await this.packages?.remove(source, scope);
        this.publishSettings();
      },
      setSkillEnabled: (name, enabled) => {
        const workspace = this.currentWorkspace;
        if (!workspace) return;
        const policy = readWorkspacePolicy(workspace.id);
        const disabled = new Set(policy.disabledSkills);
        if (enabled) disabled.delete(name);
        else disabled.add(name);
        writeWorkspacePolicy(workspace.id, { disabledSkills: [...disabled] });
        this.skills?.setDisabled([...disabled]);
        this.publishSettings();
      },
      preferences: () => {
        const preferences = readUserPreferences();
        return {
          theme: preferences.theme,
          locale: preferences.locale,
          proxy: preferences.proxy,
          githubToken: preferences.githubToken,
        };
      },
      models: () => {
        const config: ModelsConfigView = this.modelStore?.readView() ?? {
          providers: {},
        };
        return {
          providers:
            this.agentHost?.getProviderCatalog(Object.keys(config.providers)) ??
            [],
          catalog: this.agentHost?.getModelCatalog() ?? [],
          config,
        };
      },
      loginProvider: async (input) => {
        await this.ensureAgent();
        await this.agentHost!.loginProvider(input);
        this.publishSettings();
      },
      logoutProvider: async (providerId) => {
        await this.ensureAgent();
        await this.agentHost!.logoutProvider(providerId);
        this.publishSettings();
      },
      saveProvider: async (providerId, config) => {
        await this.ensureAgent();
        await this.modelStore!.saveProvider(
          providerId,
          config as ProviderConfigView,
        );
        await this.agentHost!.rebuildForModelChange();
        this.publishSettings();
      },
      deleteProvider: async (providerId) => {
        await this.ensureAgent();
        await this.modelStore!.deleteProvider(providerId);
        await this.agentHost!.rebuildForModelChange();
        this.publishSettings();
      },
      saveModel: async (providerId, model) => {
        await this.ensureAgent();
        await this.modelStore!.saveModel(providerId, model as ModelConfigView);
        await this.agentHost!.rebuildForModelChange();
        this.publishSettings();
      },
      deleteModel: async (providerId, modelId) => {
        await this.ensureAgent();
        await this.modelStore!.deleteModel(providerId, modelId);
        await this.agentHost!.rebuildForModelChange();
        this.publishSettings();
      },
      advanced: () => ({
        settings: this.piSettings?.view() ?? null,
        bindings: this.uraRuntime?.ura.bindings() ?? [],
      }),
      setGlobalSetting: (path, value) => {
        const next = this.piSettings!.setGlobal(path, value);
        this.publishSettings();
        return next;
      },
      setProjectSetting: (path, value) => {
        const next = this.piSettings!.setProject(path, value);
        this.publishSettings();
        return next;
      },
      reloadAdvanced: () => this.piSettings?.reload() ?? null,
      replaceSettings: (scope, value) => {
        const next = this.piSettings!.replace(scope, value);
        this.publishSettings();
        return next;
      },
      setBinding: async (binding) => {
        const runtime = await this.ensureResources();
        return runtime.ura.ura.setBinding(binding as never);
      },
      removeBinding: async (transport, mime) => {
        const runtime = await this.ensureResources();
        return runtime.ura.ura.removeBinding(transport, mime);
      },
      setPreferences: (patch) => {
        const next = writeUserPreferences(patch);
        if (patch.theme) this.theme.apply(patch.theme);
        this.publishSettings();
        return {
          theme: next.theme,
          locale: next.locale,
          proxy: next.proxy,
          githubToken: next.githubToken,
        };
      },
    });
    defineUpdatesDomain(this.domains, {
      status: () => this.updates.status(),
      check: () => this.updates.check(),
      download: () => this.updates.download(),
      cancel: () => this.updates.cancel(),
      open: () => {
        const file = this.updates.status().file;
        if (file) this.actions.openPath(file);
      },
    });
    definePluginsDomain(this.domains, {
      runtime: () => this.resourcesRuntime(),
      ensure: () => this.ensureResources(),
      open: (pluginId, surface) => this.appViews.openPlugin(pluginId, surface),
      installed: () => this.plugins?.installed() ?? [],
      catalog: () => this.pluginCatalog?.currentUrl() ?? '',
      catalogRefresh: async () => {
        await this.ensureResources();
        return this.pluginCatalog?.load() ?? { entries: [] };
      },
      task: () => this.plugins?.task ?? null,
      cancel: () => this.plugins?.cancelInstall() ?? null,
      retry: async () => {
        await this.plugins?.retryInstall();
        this.publishSettings();
      },
      install: async (source) => {
        await this.ensureResources();
        await this.plugins!.install(source);
        this.publishSettings();
      },
      remove: async (source) => {
        await this.ensureResources();
        await this.plugins!.remove(source);
        this.publishSettings();
      },
      reload: async (source) => {
        await this.ensureResources();
        await this.plugins!.install(source, true);
        this.publishSettings();
      },
    });
    defineListsDomain(this.domains, {
      snapshot: () => this.listsSnapshot,
      refresh: () => this.refreshLists(),
      openItem: (item) => this.openListItem(item),
    });
    defineSessionsDomain(this.domains, {
      ensure: () => this.ensureAgent(),
      current: () => this.sessionsService?.current ?? null,
      list: () => this.sessionsService?.list ?? [],
      models: () => this.sessionsService?.models() ?? [],
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
        const sessions = this.sessionsService;
        const file = sessionId ?? sessions?.current?.sessionFile;
        if (!sessions || !file) throw new Error('no active session');
        sessions.rename(encodeURIComponent(file), name);
      },
      deleteActive: async (sessionId) => {
        const sessions = this.sessionsService;
        const file = sessionId ?? sessions?.current?.sessionFile;
        if (!sessions || !file) throw new Error('no active session');
        await sessions.deleteSession(encodeURIComponent(file));
      },
      setModel: (provider, modelId) =>
        this.sessionsService!.setModel(provider, modelId),
      setThinking: (level) => this.sessionsService!.setThinking(level),
      thinkingLevels: () =>
        this.agentHost?.session.getAvailableThinkingLevels() ?? [],
      activeSkills: () => this.skills?.getActive() ?? [],
      setActiveSkills: (names) => {
        this.skills?.setActive(names);
        this.publishSessions();
        return this.skills?.getActive() ?? [];
      },
      refresh: () => this.sessionsService!.refresh(),
    });
    bindWindowDomains(
      this.domains,
      this.windows,
      this.scene,
      this.options.capturePreload,
    );

    registerAppProviders(this.views, {
      options: this.options,
      ensureResources: () => this.ensureResources(),
      resources: () => this.resourcesService,
    });

    this.pipeline = new Pipeline(this.domains, this.views);
    this.dispatcher = new Dispatcher(this.views, this.pipeline);
    this.windows.onOpen((window) => {
      this.appViews.ensureAssistant(window);
      this.appViews.ensureOverlay(window);
    });
    this.windows.onClose((window) => {
      this.releaseWorkspace(window);
      if (this.currentWorkspace?.id === window.wsId) {
        this.currentWorkspace = null;
        this.workspaceRepo.writeCurrent(null);
        this.resourcesService?.reset();
        this.resourcesWorkspaceId = null;
        this.resourcesInit = null;
      }
      this.publishWorkspaces();
      this.publishResources();
    });
  }

  /** 进程入口：single instance / whenReady / 退出事件都在这里。 */
  static async run(options: AppOptions = {}): Promise<App | null> {
    if (!electronApp.requestSingleInstanceLock()) {
      electronApp.quit();
      return null;
    }

    App.applyRemoteDebugging(options.debugPort);
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'app',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
        },
      },
    ]);
    const dataRoot = initDataRoot();
    initAgentDir(dataRoot.root);
    await electronApp.whenReady();
    serveAppPages(session.defaultSession, new WeakSet());
    const app = new App(options);

    electronApp.on('second-instance', () => app.activate());
    electronApp.on('activate', () => app.activate());
    electronApp.on('window-all-closed', () => {
      if (process.platform !== 'darwin') electronApp.quit();
    });

    app.start();
    return app;
  }

  /**
   * CDP 调试端口：必须在 ready 前追加，ready 之后再设置不生效。
   * e2e / live-dev 通过固定端口连接 dev 窗口，不能依赖各入口自行处理。
   */
  private static applyRemoteDebugging(port: string | undefined): void {
    // Playwright / 外部启动器已经占了调试端口时不要再追加一个。
    if (electronApp.commandLine.hasSwitch('remote-debugging-port')) return;
    const value = port ?? process.env['WA_DEBUG_PORT'];
    if (!value || !/^\d+$/.test(value)) return;
    electronApp.commandLine.appendSwitch('remote-debugging-port', value);
  }

  get isStarted(): boolean {
    return this.started;
  }

  use(middleware: Middleware): this {
    this.pipeline.use(middleware);
    return this;
  }

  /** 在 Electron ready 之后同步启动；不负责单实例锁或进程事件。 */
  start(): this {
    if (this.started) return this;
    if (!electronApp.isReady()) {
      throw new Error('App.start() must be called after app.whenReady()');
    }

    try {
      this.pipeline.activate();
      this.theme.bind();
      this.theme.apply(
        normalizeAppearance(readUserPreferences().appearance).theme,
      );
      installMenu(this.windows);
      this.offLayout = applyLayoutUpdates(this.domains, this.windows);
      this.started = true;
      this.attachIpc();
      this.views.setZoomFactor(
        normalizeAppearance(readUserPreferences().appearance).zoom / 100,
      );
      const restored = this.options.workspaceId
        ? (this.workspaceRepo
            .list()
            .find((meta) => meta.id === this.options.workspaceId) ?? null)
        : this.workspaceRepo.restore();
      if (restored) this.openWorkspace(restored.id);
      else if (this.options.workspaceId)
        this.openWorkspace(this.options.workspaceId);
    } catch (error) {
      this.rollbackStart();
      throw error;
    }

    return this;
  }

  stop(): void {
    if (!this.started) return;

    this.started = false;
    this.detachIpc();

    try {
      this.offLayout?.();
      this.offLayout = null;
      this.theme.unbind();
      this.windows.closeAll();
      this.views.dispose();
    } finally {
      this.pipeline.deactivate();
    }
  }

  openWorkspace(wsId: string): WorkspaceWindow {
    if (!this.started) throw new Error('app is not started');

    const meta = this.workspaceRepo.list().find((item) => item.id === wsId);
    const previous =
      meta && this.currentWorkspace && this.currentWorkspace.id !== meta.id
        ? this.windows.list().filter((window) => window.wsId !== wsId)
        : [];
    if (meta) {
      this.currentWorkspace = meta;
      this.workspaceRepo.writeCurrent(meta.id);
    }

    const existing = this.windows.get(wsId);
    if (existing) {
      existing.focus();
      this.publishWorkspaces();
      return existing;
    }

    const window = this.windows.open(wsId, this.options.window);
    if (this.options.url) window.load(this.options.url);
    else if (this.options.window?.show !== false) window.show();
    this.publishWorkspaces();
    this.appViews.ensureAssistant(window);
    this.appViews.ensureOverlay(window);
    this.appViews.ensureWelcome(window);
    this.domains.define('layout').resource(wsId).publish();
    if (previous.length > 0) {
      // 当前实现是单 agent / 单资源运行时：切换工作区后关闭旧窗口。
      // 延后到命令响应之后再关，避免发起切换的 renderer 被中途销毁。
      setTimeout(() => {
        for (const old of previous) old.close();
      }, 80);
    }
    void this.ensureResources().catch((error: unknown) => {
      console.error('[app] resources init failed', error);
    });
    void this.ensureAgent().catch((error: unknown) => {
      console.error('[app] agent init failed', error);
    });
    return window;
  }

  closeWorkspace(wsId: string): void {
    if (!this.started) return;
    if (this.currentWorkspace?.id === wsId) {
      this.currentWorkspace = null;
      this.workspaceRepo.writeCurrent(null);
    }
    this.windows.close(wsId);
    this.publishWorkspaces();
  }

  activate(): void {
    if (!this.started) return;

    const active = this.windows.active();
    if (active) {
      active.focus();
      return;
    }

    const wsId = this.windows.lastWorkspaceId ?? this.options.workspaceId;
    if (wsId) this.openWorkspace(wsId);
  }

  private attachIpc(): void {
    if (this.ipcAttached) return;
    this.ipcAttached = true;

    try {
      ipcMain.handle(IPC_CHANNELS.subscribe, this.onSubscribe);
      ipcMain.on(IPC_CHANNELS.unsubscribe, this.onUnsubscribe);
      ipcMain.handle(IPC_CHANNELS.command, this.onCommand);
      ipcMain.on(IPC_CHANNELS.notify, this.onNotify);
      ipcMain.on(CH_BUS, this.onViewBus);
      ipcMain.handle(CH_URA_WATCH, this.onUraWatch);
    } catch (error) {
      this.detachIpc();
      throw error;
    }
  }

  private detachIpc(): void {
    if (!this.ipcAttached) return;

    ipcMain.removeHandler(IPC_CHANNELS.subscribe);
    ipcMain.removeListener(IPC_CHANNELS.unsubscribe, this.onUnsubscribe);
    ipcMain.removeHandler(IPC_CHANNELS.command);
    ipcMain.removeListener(IPC_CHANNELS.notify, this.onNotify);
    ipcMain.removeListener(CH_BUS, this.onViewBus);
    ipcMain.removeHandler(CH_URA_WATCH);
    this.viewWatch?.close();
    this.viewWatch = null;
    this.ipcAttached = false;
  }

  private readonly onSubscribe = (
    event: IpcMainInvokeEvent,
    domain: string,
    resource: string,
  ) => this.dispatcher.subscribe(event.sender.id, domain, resource);

  private readonly onUnsubscribe = (
    event: IpcMainEvent,
    domain: string,
    resource: string,
  ) => {
    this.dispatcher.unsubscribe(event.sender.id, domain, resource);
  };

  private readonly onCommand = (
    event: IpcMainInvokeEvent,
    domain: string,
    resource: string,
    action: string,
    input: unknown,
  ) =>
    this.dispatcher.command(event.sender.id, domain, resource, action, input);

  private readonly onNotify = (
    event: IpcMainEvent,
    domain: string,
    resource: string,
    action: string,
    value: unknown,
  ) => {
    this.dispatcher.notify(event.sender.id, domain, resource, action, value);
  };

  private viewOfSender(senderId: number): {
    id: string;
    sessionId: string | null;
  } | null {
    const origin = this.views.originOf(String(senderId));
    if (origin?.type !== 'view') return null;
    const record = this.views.get(origin.viewId);
    return record ? { id: record.id, sessionId: record.sessionId } : null;
  }

  private readonly onViewBus = (
    event: IpcMainEvent,
    message: unknown,
  ): void => {
    const view = this.viewOfSender(event.sender.id);
    if (!view) return;
    const value = message as {
      type?: string;
      dirty?: boolean;
    };
    if (value.type === 'loaded') {
      if (view.sessionId && this.resourcesService) {
        const payload = this.resourcesService.pageContent(view.sessionId);
        if (payload !== undefined) {
          event.sender.send(CH_BUS, { type: 'content', payload });
        }
      }
      event.sender.send(CH_BUS, { type: 'theme', theme: this.theme.read() });
      return;
    }
    if (value.type === 'dirty' && typeof value.dirty === 'boolean') {
      this.views.setDirty(view.id, value.dirty);
      return;
    }
    if (value.type === 'actionState') {
      const state = message as { id?: string; value?: unknown };
      this.views.setActionState(
        view.id,
        String(state.id ?? ''),
        String(state.value ?? ''),
      );
      return;
    }
    if (value.type === 'navigate') {
      const nav = message as { url?: string };
      if (nav.url) this.views.navigate(view.id, nav.url);
      return;
    }
    if (value.type === 'self-action') {
      const action = message as { id?: string };
      this.views.sendAction(view.id, String(action.id ?? 'save'));
      return;
    }
    if (value.type === 'self-reload') {
      void this.views.refresh(view.id);
    }
  };

  private readonly onUraWatch = (
    event: IpcMainInvokeEvent,
    ref?: string,
  ): { ref: string } => {
    const target = String(ref ?? '');
    this.viewWatch?.close();
    this.viewWatch = null;
    if (!target || !this.uraRuntime) return { ref: target };
    this.viewWatch = this.uraRuntime.ura.watch(target, (change) => {
      if (!event.sender.isDestroyed()) event.sender.send(CH_URA, change);
    });
    return { ref: target };
  };

  private rollbackStart(): void {
    this.started = false;
    this.detachIpc();

    try {
      this.offLayout?.();
      this.offLayout = null;
      this.theme.unbind();
      this.windows.closeAll();
      this.views.dispose();
    } finally {
      this.pipeline.deactivate();
    }
  }

  private resourcesRuntime(): ResourcesRuntime | null {
    return this.resourcesService && this.uraRuntime
      ? { service: this.resourcesService, ura: this.uraRuntime }
      : null;
  }

  private ensureResources(): Promise<ResourcesRuntime> {
    const workspace = this.currentWorkspace;
    if (!workspace) return Promise.reject(new Error('no workspace'));
    if (this.resourcesInit && this.resourcesWorkspaceId === workspace.id) {
      return this.resourcesInit;
    }

    const init = (async (): Promise<ResourcesRuntime> => {
      if (!this.pluginService) {
        this.pluginService = new PluginService({
          root: pluginsRoot(),
          cwd: () => this.currentWorkspace?.path ?? '',
        });
        await this.pluginService.start();
        this.pluginCatalog = new PluginCatalogService({
          cacheFile: pluginCatalogFile(),
          urlFile: pluginCatalogUrlFile(),
        });
        await this.pluginCatalog.start();
      }
      if (!this.uraRuntime) {
        const appPath = electronApp.getAppPath();
        this.uraRuntime = await createUraRuntime({
          dataRoot: pluginDataRoot(),
          bindingFile: uraBindingsFile(),
          workspace: () => this.currentWorkspace?.path ?? '',
          registerFeatures: registerBrowserFeatures,
          pluginRoots: [
            ...(this.pluginService?.roots() ?? []),
            join(appPath, 'src', 'plugins'),
            join(appPath, 'out', 'plugins'),
            pluginsRoot(),
          ],
        });
      }
      if (!this.plugins && this.pluginService && this.pluginCatalog) {
        this.plugins = new PluginsService({
          service: this.pluginService,
          catalog: this.pluginCatalog,
          host: this.uraRuntime.host,
        });
        this.plugins.onChange(() => this.publishSettings());
        this.plugins.onTask(() => {
          this.domains.define('plugins').resource('task').publish();
        });
      }
      if (!this.resourcesService) {
        this.resourcesService = new ResourcesService({
          ura: this.uraRuntime.ura,
          pages: new PageSessions(this.uraRuntime.ura),
        });
        this.resourcesService.onPagesChange(() => this.publishResources());
      } else {
        this.resourcesService.reset();
        this.uraRuntime.map.restart();
      }
      this.resourcesWorkspaceId = workspace.id;
      this.publishResources();
      this.publishSettings();
      void this.refreshLists().catch((error: unknown) => {
        console.error('[app] lists refresh failed', error);
      });
      return { service: this.resourcesService, ura: this.uraRuntime };
    })();

    this.resourcesInit = init.catch((error: unknown) => {
      this.resourcesInit = null;
      throw error;
    });
    return this.resourcesInit;
  }

  private ensureAgent(): Promise<void> {
    const workspace = this.currentWorkspace;
    if (!workspace) return Promise.reject(new Error('no workspace'));
    if (this.agentInit && this.agentWorkspaceId === workspace.id) {
      return this.agentInit;
    }
    if (this.agentHost) {
      this.agentInit = (async () => {
        await this.agentHost!.setWorkspace(workspace.path);
        this.skills?.setDisabled(
          readWorkspacePolicy(workspace.id).disabledSkills,
        );
        await this.sessionsService?.reloadWorkspace();
        this.piSettings = this.settingsStoreFor(workspace.id);
        this.agentWorkspaceId = workspace.id;
        this.publishSessions();
        this.publishSettings();
        void this.refreshLists();
      })().catch((error: unknown) => {
        this.agentInit = null;
        throw error;
      });
      return this.agentInit;
    }
    this.agentInit = (async () => {
      const runtime = await this.ensureResources();
      const skills = new SkillsManager();
      skills.setDisabled(readWorkspacePolicy(workspace.id).disabledSkills);
      this.skills = skills;
      const host = await AgentHost.bootstrap(
        {
          ura: runtime.ura.ura,
          skills,
          registry: runtime.ura.host,
          getBrowserAutomation: () => null,
          sendEvent: (frame) => this.sessionsService?.receiveFrame(frame),
          onTurnFinished: () => {
            void this.sessionsService?.refresh();
            void this.refreshLists();
          },
          onWorkspaceChange: () => undefined,
          ui: {
            onDialogRequest: (request) => this.dialogs.open(request as never),
            onDialogResolved: (id) => this.dialogs.resolve(id),
            onNotify: (message, level, source) =>
              this.notices.notify({
                message,
                level: level === 'warning' ? 'warn' : level,
                source,
              }),
          },
          openExternal: (url) => this.actions.openExternal(url),
        },
        workspace.path,
      );
      this.agentHost = host;
      this.modelStore ??= new ModelConfigStore(getAgentDir());
      this.piSettings ??= this.settingsStoreFor(workspace.id);
      this.packages = new PiPackageService({
        settingsManager: () => this.agentHost?.settingsManager ?? null,
        cwd: () => this.currentWorkspace?.path ?? '',
        agentDir: () => getAgentDir(),
        onChanged: () => this.agentHost?.reloadResources(),
      });
      const sessions = new SessionsService(host);
      this.sessionsService = sessions;
      sessions.onChange(() => this.publishSessions());
      sessions.onStream(() => {
        // 流式增量只影响 active；列表/消息在 onChange 时发布。
        this.domains.define('sessions').resource('active').publish();
      });
      await sessions.start();
      this.agentWorkspaceId = workspace.id;
      this.publishSessions();
      this.publishSettings();
    })().catch((error: unknown) => {
      this.agentInit = null;
      throw error;
    });
    return this.agentInit;
  }

  private settingsStoreFor(wsId: string): PiSettingsService {
    return new PiSettingsService(
      new AppSpaceSettingsStorage(
        join(getDataRoot(), 'settings.json'),
        join(getWorkspaceBase(wsId), 'settings.json'),
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
    const domain = this.domains.define('sessions');
    for (const name of [
      'current',
      'list',
      'models',
      'commands',
      'active',
      'opened',
      'task',
      'thinking',
      'skills',
    ]) {
      domain.resource(name).publish();
    }
  }

  private ensureLists(): Promise<ListsRuntime> {
    return this.ensureResources().then((runtime) => {
      if (!this.listsRuntime) {
        this.listsRuntime = createListsRuntime({
          contexts: runtime.ura.contexts,
          plugins: () => runtime.ura.host,
          settingsPages: () => settingsPages(),
          sessions: () => ({
            activePath: this.sessionsService?.current?.sessionFile ?? null,
            list: this.sessionsService?.list ?? [],
          }),
          viewHost: {
            list: () =>
              this.views.list().map((view) => ({
                id: view.id,
                type: view.type,
                title: view.title,
                url: view.url,
                active: view.active,
                dirty: view.dirty,
                document: (() => {
                  const sessionId = this.views.get(view.id)?.sessionId;
                  return sessionId
                    ? { id: this.resourcesService?.page(sessionId)?.ref }
                    : undefined;
                })(),
              })),
          },
        });
      }
      return this.listsRuntime;
    });
  }

  private refreshLists(): Promise<void> {
    if (this.listsRefresh) return this.listsRefresh;
    this.listsRefresh = this.ensureLists()
      .then((service) => service.snapshot())
      .then((snapshot) => {
        this.listsSnapshot = snapshot;
        this.domains.define('lists').resource('current').publish();
      })
      .finally(() => {
        this.listsRefresh = null;
      });
    return this.listsRefresh;
  }

  private async openListItem(item: ListItem): Promise<unknown> {
    const meta = item.meta ?? {};
    const ref = meta['ref'];
    if (typeof ref === 'string' && ref) return this.appViews.openResource(ref);
    const pageId = meta['pageId'];
    if (typeof pageId === 'string' && pageId)
      return this.appViews.openSettings(pageId);
    const pluginId = meta['pluginId'];
    if (typeof pluginId === 'string' && pluginId)
      return this.appViews.openPlugin(pluginId, 'settings');
    throw new Error(`list item has no open target: ${item.key}`);
  }

  private persistThemeSource(source: 'light' | 'dark' | 'system'): void {
    const current = readUserPreferences();
    const appearance = normalizeAppearance(
      { ...current.appearance, theme: source },
      current.theme,
    );
    writeUserPreferences({
      appearance,
      theme: source === 'system' ? current.theme : source,
    });
    this.publishSettings();
  }

  private appearanceSnapshot(): AppearanceSnapshot {
    const preferences = readUserPreferences();
    return resolveAppearance(
      preferences.appearance,
      nativeTheme.shouldUseDarkColors,
    );
  }

  private updateAppearance(
    patch: Partial<AppearanceSettings>,
  ): AppearanceSnapshot {
    const current = readUserPreferences();
    const appearance = normalizeAppearance(
      { ...current.appearance, ...patch },
      current.theme,
    );
    writeUserPreferences({ appearance });
    const snapshot = resolveAppearance(
      appearance,
      nativeTheme.shouldUseDarkColors,
    );
    writeUserPreferences({
      appearance,
      theme: snapshot.effectiveTheme,
    });
    this.theme.apply(appearance.theme);
    this.views.setZoomFactor(appearance.zoom / 100);
    this.publishSettings();
    return snapshot;
  }

  private settingsStorage(): SettingsStorageView {
    const workspace = this.currentWorkspace;
    const base = workspace ? getWorkspaceBase(workspace.id) : '';
    return {
      dataRoot: getDataRoot(),
      appPath: electronApp.getAppPath(),
      workspacePath: workspace?.path ?? '',
      workspaceId: workspace?.id ?? '',
      sceneFile: base ? join(base, 'scene.json') : '',
      sessionsDir:
        this.agentHost?.resolveSessionsDir() ??
        (base ? join(base, 'sessions') : ''),
      versions: {
        app: electronApp.getVersion(),
        electron: process.versions['electron'] ?? '',
        chrome: process.versions['chrome'] ?? '',
        node: process.versions['node'] ?? '',
      },
    };
  }

  private publishSettings(): void {
    const domain = this.domains.define('settings');
    for (const name of [
      'pages',
      'appearance',
      'storage',
      'browser',
      'models',
      'skills',
      'preferences',
      'advanced',
      'resourceInfo',
      'extensions',
    ]) {
      domain.resource(name).publish();
    }
    const plugins = this.domains.define('plugins');
    for (const name of ['list', 'installed', 'catalog', 'task']) {
      plugins.resource(name).publish();
    }
  }

  private publishUpdates(): void {
    this.domains.define('updates').resource('status').publish();
  }

  private publishResources(): void {
    this.domains.define('resources').resource('current').publish();
    if (this.resourcesReady()) {
      void this.refreshLists().catch(() => undefined);
    }
  }

  private resourcesReady(): boolean {
    return Boolean(this.resourcesService && this.uraRuntime);
  }

  private publishWorkspaces(): void {
    const domain = this.domains.define('workspaces');
    domain.resource('list').publish();
    domain.resource('current').publish();
  }

  private setOverlayVisible(visible: boolean): void {
    for (const window of this.windows.list()) {
      for (const view of window.global.list()) {
        if (view.type === 'overlay') window.global.show(view.id, visible);
      }
    }
  }

  private releaseWorkspace(window: WorkspaceWindow): void {
    const viewIds = [...window.global.ids(), ...window.tabs.ids()];
    this.views.release(window);
    window.global.clear();
    window.tabs.clear();
    for (const viewId of viewIds) this.domains.unsubscribeView(viewId);
  }
}
