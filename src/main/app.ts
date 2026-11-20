/**
 * app 组件：应用运行时 + IPC transport。
 *
 *   Dispatcher   sender → origin → DomainRegistry + IPC 请求日志
 *   App          Domain / View / Dispatcher 的组合根与 IPC 生命周期
 *
 * App.start() 必须在 Electron ready 之后调用；进程生命周期、单实例锁、
 * whenReady、quit 等由 main 的 Bootstrap 负责。
 */

import { app as electronApp, ipcMain, protocol, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { initDataRoot, profileDir } from './runtime/storage/data-root.ts';
import { initWorkspaceStorage } from './agent/workspace.ts';
import { serveAppPages } from './domains/shell/app-pages.ts';
import { readUserPreferences } from './runtime/storage/preferences.ts';
import { CH_BUS, CH_URA, CH_URA_WATCH } from '../shared/channels.ts';
import { normalizeAppearance } from '../shared/appearance.ts';
import { DomainRegistry } from './runtime/domains.ts';
import {
  createStoragePaths,
  type StoragePaths,
} from './runtime/storage/storage-paths.ts';
import { ShellDomain } from './domains/shell/module.ts';
import { WorkspaceModule } from './domains/workspace/module.ts';
import { AgentDomain } from './domains/agent/module.ts';
import { SettingsDomain } from './domains/settings/module.ts';
import { Dispatcher } from './runtime/dispatcher.ts';
import { IPC_CHANNELS } from './runtime/shared.ts';
import type {
  SceneOptions,
  WindowOptions,
  WorkspaceWindow,
} from './domains/shell/native.ts';
import { registerAppProviders } from './domains/workspace/app-providers.ts';

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
  /** 打开 IPC 请求日志；缺省读 WA_IPC_LOG。 */
  ipcLog?: boolean;
  /** bootstrap 已解析的存储路径。 */
  storage: StoragePaths;
}

export type AppRunOptions = Omit<AppOptions, 'storage'>;

export class App {
  readonly domains: DomainRegistry;
  readonly dispatcher: Dispatcher;

  private readonly options: AppOptions;
  private readonly storage: StoragePaths;
  private readonly shellDomain: ShellDomain;
  private readonly workspaceModule: WorkspaceModule;
  private readonly agentDomain: AgentDomain;
  private readonly settingsDomain: SettingsDomain;
  private viewWatch: { close(): void } | null = null;
  private ipcAttached = false;
  private started = false;

  constructor(options: AppOptions) {
    this.options = options;
    this.storage = options.storage;
    this.domains = new DomainRegistry();
    this.shellDomain = new ShellDomain({
      registry: this.domains,
      storage: this.storage,
      ...(options.window ? { window: options.window } : {}),
      ...(options.scene ? { scene: options.scene } : {}),
      ...(options.capturePreload
        ? { capturePreload: options.capturePreload }
        : {}),
      appViews: {
        ...(options.rendererPage ? { rendererPage: options.rendererPage } : {}),
        ...(options.preloads ? { preloads: options.preloads } : {}),
      },
      started: () => this.started,
      currentWorkspace: () => this.workspaceModule.current,
      ensureResources: () => this.workspaceModule.ensure(),
      resources: () => this.workspaceModule.resources(),
      ensureAgent: () => this.agentDomain.ensure(),
      openWorkspace: (wsId) => this.openWorkspace(wsId),
      onThemeSource: (source) => this.settingsDomain.setThemeSource(source),
    });
    this.domains.registerModule(this.shellDomain);
    this.workspaceModule = new WorkspaceModule({
      storage: this.storage,
      appPath: () => electronApp.getAppPath(),
      views: this.shellDomain.views,
      agent: () => this.agentDomain,
      openWindow: (wsId) => this.openWorkspace(wsId),
      closeWindow: (wsId) => this.closeWorkspace(wsId),
      openResource: (ref) => this.shellDomain.appViews.openResource(ref),
      openWeb: (url, title) => this.shellDomain.appViews.openWeb(url, title),
      openPlugin: (pluginId, surface) =>
        this.shellDomain.appViews.openPlugin(pluginId, surface),
      openPageView: (ref) =>
        this.shellDomain.appViews.openResourcePageView(ref),
      savePageCopy: (pageId, content) =>
        this.shellDomain.appViews.savePageCopy(pageId, content),
      openItem: async (item) => {
        const meta = item.meta ?? {};
        const ref = meta['ref'];
        if (typeof ref === 'string' && ref)
          return this.shellDomain.appViews.openResource(ref);
        const pageId = meta['pageId'];
        if (typeof pageId === 'string' && pageId)
          return this.shellDomain.appViews.openSettings(pageId);
        const pluginId = meta['pluginId'];
        if (typeof pluginId === 'string' && pluginId)
          return this.shellDomain.appViews.openPlugin(pluginId, 'settings');
        throw new Error(`list item has no open target: ${item.key}`);
      },
      onChanged: () => this.publishResources(),
      onSettingsChanged: () => this.publishSettings(),
    });
    this.domains.registerModule(this.workspaceModule);
    this.agentDomain = new AgentDomain({
      current: () => this.workspaceModule.current,
      storage: this.storage,
      workspace: this.workspaceModule,
      views: this.shellDomain.views,
      windows: this.shellDomain.windows,
      actions: this.shellDomain.actions,
      dialogs: this.shellDomain.dialogs,
      notices: this.shellDomain.notices,
      openWeb: (url, title) => this.shellDomain.appViews.openWeb(url, title),
      openPlugin: (pluginId) =>
        this.shellDomain.appViews.openPlugin(pluginId, 'settings'),
      onSettingsChanged: () => this.publishSettings(),
      onListsChanged: () => {
        void this.workspaceModule.refresh();
      },
    });
    this.domains.registerModule(this.agentDomain);
    this.settingsDomain = new SettingsDomain({
      current: () => this.workspaceModule.current,
      storage: this.storage,
      workspace: this.workspaceModule,
      agent: this.agentDomain,
      theme: this.shellDomain.theme,
      views: this.shellDomain.views,
      actions: this.shellDomain.actions,
      openSettings: (pageId) => this.shellDomain.appViews.openSettings(pageId),
      onBrowserChanged: () => {
        void this.workspaceModule.refresh();
      },
      appPath: () => electronApp.getAppPath(),
      appVersion: () => electronApp.getVersion(),
    });
    this.domains.registerModule(this.settingsDomain);
    registerAppProviders(this.shellDomain.views, {
      options: this.options,
      ensureResources: () => this.workspaceModule.ensure(),
      resources: () => this.workspaceModule.resources(),
    });

    this.dispatcher = new Dispatcher(this.shellDomain.views, this.domains, {
      log: options.ipcLog ?? process.env['WA_IPC_LOG'] === '1',
    });
    this.shellDomain.windows.onOpen((window) => {
      this.shellDomain.appViews.ensureAssistant(window);
      this.shellDomain.appViews.ensureOverlay(window);
    });
    this.shellDomain.windows.onClose((window) => {
      this.releaseWorkspace(window);
      if (this.workspaceModule.current?.id === window.wsId) {
        this.workspaceModule.setCurrent(null);
        this.workspaceModule.reset();
      }
      this.publishWorkspaces();
      this.publishResources();
    });
  }

  /** 进程入口：single instance / whenReady / 退出事件都在这里。 */
  static async run(options: AppRunOptions = {}): Promise<App | null> {
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
    const storage = createStoragePaths({
      dataRoot: dataRoot.root,
      profileDir: profileDir(),
    });
    initWorkspaceStorage(storage);
    await electronApp.whenReady();
    serveAppPages(session.defaultSession, new WeakSet());
    const app = new App({ ...options, storage });

    electronApp.on('second-instance', () => app.activate());
    electronApp.on('activate', () => app.activate());
    electronApp.on('window-all-closed', () => {
      if (process.platform !== 'darwin') electronApp.quit();
    });

    await app.start();
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

  /** 在 Electron ready 之后同步启动；不负责单实例锁或进程事件。 */
  async start(): Promise<this> {
    if (this.started) return this;
    if (!electronApp.isReady()) {
      throw new Error('App.start() must be called after app.whenReady()');
    }

    try {
      this.dispatcher.activate();
      await this.domains.startModules();
      this.shellDomain.theme.apply(
        normalizeAppearance(readUserPreferences().appearance).theme,
      );
      this.started = true;
      this.attachIpc();
      this.shellDomain.views.setZoomFactor(
        normalizeAppearance(readUserPreferences().appearance).zoom / 100,
      );
      const restored = this.workspaceModule.restore(this.options.workspaceId);
      if (restored) this.openWorkspace(restored.id);
      else if (this.options.workspaceId)
        this.openWorkspace(this.options.workspaceId);
    } catch (error) {
      await this.rollbackStart();
      throw error;
    }

    return this;
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    this.started = false;
    this.detachIpc();

    try {
    } finally {
      await this.domains.stopModules();
      this.dispatcher.deactivate();
    }
  }

  openWorkspace(wsId: string): WorkspaceWindow {
    if (!this.started) throw new Error('app is not started');

    const meta = this.workspaceModule.find(wsId);
    const previous =
      meta &&
      this.workspaceModule.current &&
      this.workspaceModule.current.id !== meta.id
        ? this.shellDomain.windows
            .list()
            .filter((window) => window.wsId !== wsId)
        : [];
    if (meta) this.workspaceModule.setCurrent(meta);

    const existing = this.shellDomain.windows.get(wsId);
    if (existing) {
      existing.focus();
      this.publishWorkspaces();
      return existing;
    }

    const window = this.shellDomain.windows.open(wsId, this.options.window);
    if (this.options.url) window.load(this.options.url);
    else if (this.options.window?.show !== false) window.show();
    this.publishWorkspaces();
    this.shellDomain.appViews.ensureAssistant(window);
    this.shellDomain.appViews.ensureOverlay(window);
    this.shellDomain.appViews.ensureWelcome(window);
    this.domains.define('shell').resource(`layout:${wsId}`).publish();
    if (previous.length > 0) {
      // 当前实现是单 agent / 单资源运行时：切换工作区后关闭旧窗口。
      // 延后到命令响应之后再关，避免发起切换的 renderer 被中途销毁。
      setTimeout(() => {
        for (const old of previous) old.close();
      }, 80);
    }
    void this.workspaceModule.ensure().catch((error: unknown) => {
      console.error('[app] resources init failed', error);
    });
    void this.agentDomain.ensure().catch((error: unknown) => {
      console.error('[app] agent init failed', error);
    });
    return window;
  }

  closeWorkspace(wsId: string): void {
    if (!this.started) return;
    if (this.workspaceModule.current?.id === wsId) {
      this.workspaceModule.setCurrent(null);
      this.workspaceModule.reset();
    }
    this.shellDomain.windows.close(wsId);
    this.publishWorkspaces();
  }

  activate(): void {
    if (!this.started) return;

    const active = this.shellDomain.windows.active();
    if (active) {
      active.focus();
      return;
    }

    const wsId =
      this.shellDomain.windows.lastWorkspaceId ?? this.options.workspaceId;
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
    const origin = this.shellDomain.views.originOf(String(senderId));
    if (origin?.type !== 'view') return null;
    const record = this.shellDomain.views.get(origin.viewId);
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
      if (view.sessionId && this.workspaceModule.resources()) {
        const payload = this.workspaceModule
          .resources()
          ?.pageContent(view.sessionId);
        if (payload !== undefined) {
          event.sender.send(CH_BUS, { type: 'content', payload });
        }
      }
      event.sender.send(CH_BUS, {
        type: 'theme',
        theme: this.shellDomain.theme.read(),
      });
      return;
    }
    if (value.type === 'dirty' && typeof value.dirty === 'boolean') {
      this.shellDomain.views.setDirty(view.id, value.dirty);
      return;
    }
    if (value.type === 'actionState') {
      const state = message as { id?: string; value?: unknown };
      this.shellDomain.views.setActionState(
        view.id,
        String(state.id ?? ''),
        String(state.value ?? ''),
      );
      return;
    }
    if (value.type === 'navigate') {
      const nav = message as { url?: string };
      if (nav.url) this.shellDomain.views.navigate(view.id, nav.url);
      return;
    }
    if (value.type === 'self-action') {
      const action = message as { id?: string };
      this.shellDomain.views.sendAction(view.id, String(action.id ?? 'save'));
      return;
    }
    if (value.type === 'self-reload') {
      void this.shellDomain.views.refresh(view.id);
    }
  };

  private readonly onUraWatch = (
    event: IpcMainInvokeEvent,
    ref?: string,
  ): { ref: string } => {
    const target = String(ref ?? '');
    this.viewWatch?.close();
    this.viewWatch = null;
    const ura = this.workspaceModule.ura();
    if (!target || !ura) return { ref: target };
    this.viewWatch = ura.ura.watch(target, (change) => {
      if (!event.sender.isDestroyed()) event.sender.send(CH_URA, change);
    });
    return { ref: target };
  };

  private async rollbackStart(): Promise<void> {
    this.started = false;
    this.detachIpc();

    try {
    } finally {
      await this.domains.stopModules();
      this.dispatcher.deactivate();
    }
  }

  private publishSettings(): void {
    this.settingsDomain.publish();
  }

  private publishResources(): void {
    this.workspaceModule.publishResources();
    if (this.resourcesReady()) {
      void this.workspaceModule.refresh().catch(() => undefined);
    }
  }

  private resourcesReady(): boolean {
    return Boolean(this.workspaceModule.runtime());
  }

  private publishWorkspaces(): void {
    this.workspaceModule.publish();
  }

  private releaseWorkspace(window: WorkspaceWindow): void {
    const viewIds = [...window.global.ids(), ...window.tabs.ids()];
    this.shellDomain.views.release(window);
    window.global.clear();
    window.tabs.clear();
    for (const viewId of viewIds) this.domains.unsubscribeView(viewId);
  }
}
