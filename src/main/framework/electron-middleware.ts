/**
 * Electron 中间件：主进程全局能力的提供者。
 *
 * 只提供窗口 / 原生视图 / 主题 / 现场 / 原生能力 / IPC 接线；
 * 全局策略（协议、CSP、权限、导航）也在这里落地，但由 App 层决定何时启用。
 */

import {
  BrowserWindow,
  Menu,
  WebContentsView,
  dialog,
  nativeTheme,
  protocol,
  screen,
  session,
  shell,
  type App as ElectronApp,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
  type TitleBarOverlay,
  type WebContents,
} from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CH_CAPTURE } from '../../shared/channels';
import {
  TITLEBAR_HEIGHT,
  TITLEBAR_OVERLAY_COLORS,
} from '../../shared/titlebar';
import type { LayoutSnapshot } from '../../shared/types';
import { preloadPath, themeBackground } from '../capabilities/webview/presets';
import { initDataRoot } from '../data-root';
import { rendererFile } from '../paths';
import { readUserPreferences, writeUserPreferences } from '../preferences';
import type { Theme } from '../core/types';
import type { NativeScene } from './scene';
import { applyShellCsp, hardenSession } from './electron/policy';
import { bindTransport as bindTransportIpc } from './electron/transport';
import { readScene, writeScene } from './electron/scene-store';
import type {
  Capability,
  MiddlewareContext,
  TransportBindings,
} from './middleware';

export interface WindowBounds {
  width: number;
  height: number;
}

export interface AppEnv {
  dataRoot: string;
  documentsDir: string;
  appPath: string;
}

export type PreloadName =
  | 'workbench'
  | 'assistant'
  | 'extension'
  | 'browser'
  | 'overlay'
  | 'capture';

export type ViewPreload = PreloadName | 'page' | 'web' | 'none';

export interface NativeViewInput {
  viewId: string;
  type: string;
  url: string;
  title: string;
  partition?: string;
  preload?: ViewPreload;
}

export interface ViewHooks {
  onReady?(): void;
  onCrash?(): void;
  onBus?(message: unknown): void;
}

export interface PopupMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

interface WindowPort {
  bounds(): WindowBounds | null;
  /** 指针在窗口内容坐标系中的位置；窗口不可用时为 null。 */
  cursor(): { x: number; y: number } | null;
  onBlur(listener: () => void): () => void;
  applyLayout(layout: LayoutSnapshot): void;
  webContentsId(): number | null;
  send(channel: string, payload: unknown): void;
}

interface ViewsPort {
  create(input: NativeViewInput, hooks?: ViewHooks): number | null;
  close(viewId: string): void;
  activate(viewId: string): void;
  focus(viewId: string): void;
  reload(viewId: string): void;
  navigate(viewId: string, url: string): void;
  goBack(viewId: string): void;
  goForward(viewId: string): void;
  send(viewId: string, channel: string, payload: unknown): void;
  setVisible(viewId: string, visible: boolean): void;
  /** 指针捕获层上报（CH_CAPTURE）；返回取消订阅。 */
  onCapture(listener: (message: CaptureMessage) => void): () => void;
  webContents(viewId: string): WebContents | null;
}

/** 捕获层 preload 上报的消息（见 preload/capture.ts）。 */
export interface CaptureMessage {
  type: 'move' | 'up' | 'cancel';
  buttons?: number;
}

interface ThemePort {
  read(): Theme;
  write(theme: Theme): void;
  apply(theme: Theme): void;
}

interface ScenePort {
  read(wsId: string): NativeScene | null;
  write(wsId: string, scene: NativeScene): void;
}

interface NativePort {
  openExternal(url: string): void;
  openPath(path: string): void;
  pickDirectory(): Promise<string | null>;
  pickSaveFile(input: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  popupMenu(items: PopupMenuItem[]): Promise<string | null>;
}

interface ViewEntry {
  view: WebContentsView;
  type: string;
}

export class ElectronCapability implements Capability {
  readonly id = 'electron';
  readonly env: AppEnv;
  readonly window: WindowPort;
  readonly views: ViewsPort;
  readonly theme: ThemePort;
  readonly scene: ScenePort;
  readonly native: NativePort;

  private win: BrowserWindow | null = null;
  private layout: LayoutSnapshot | null = null;
  private currentTheme: Theme;
  private readonly bootLog: string;
  private readonly dataRoot: string;
  private readonly viewsById = new Map<string, ViewEntry>();
  private readonly hooksById = new Map<string, ViewHooks>();
  private readonly blurListeners = new Set<() => void>();
  private readonly captureListeners = new Set<
    (message: CaptureMessage) => void
  >();
  /** 上次的视图栈序 key；组成不变时跳过重排。 */
  private lastStackKey = '';
  /** 上次应用的助手视图外观（形态 + 主题）；不变时跳过。 */
  private assistantChromeKey = '';
  private readonly pageSessions = new WeakSet<Session>();
  private uraWatcher:
    | ((ref: string, onEvent: (event: unknown) => void) => () => void)
    | null = null;
  private ctx!: MiddlewareContext;

  constructor(private readonly electron: ElectronApp) {
    const debugPort = process.env['WA_DEBUG_PORT'];
    if (debugPort && /^\d+$/.test(debugPort)) {
      electron.commandLine.appendSwitch('remote-debugging-port', debugPort);
    }
    const info = initDataRoot();
    this.dataRoot = info.root;
    this.bootLog = join(info.root, 'logs', 'boot.log');
    this.currentTheme = readUserPreferences().theme;
    this.env = {
      dataRoot: info.root,
      documentsDir: electron.getPath('documents'),
      appPath: electron.getAppPath(),
    };

    electron.setPath('userData', join(info.root, 'chromium'));
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

    this.window = {
      bounds: () => this.bounds(),
      cursor: () => this.cursor(),
      onBlur: (listener) => this.addListener(this.blurListeners, listener),
      applyLayout: (layout) => this.applyLayout(layout),
      webContentsId: () =>
        this.win && !this.win.isDestroyed() ? this.win.webContents.id : null,
      send: (channel, payload) => {
        if (this.win && !this.win.isDestroyed()) {
          this.win.webContents.send(channel, payload);
        }
      },
    };

    this.views = {
      create: (input, hooks) => this.createView(input, hooks),
      close: (viewId) => this.closeView(viewId),
      activate: (viewId) => this.activateView(viewId),
      focus: (viewId) => {
        const wc = this.viewsById.get(viewId)?.view.webContents;
        if (wc && !wc.isDestroyed()) wc.focus();
      },
      onCapture: (listener) =>
        this.addListener(this.captureListeners, listener),
      reload: (viewId) => this.viewsById.get(viewId)?.view.webContents.reload(),
      navigate: (viewId, url) => {
        void this.viewsById.get(viewId)?.view.webContents.loadURL(url);
      },
      goBack: (viewId) => {
        const wc = this.viewsById.get(viewId)?.view.webContents;
        if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      },
      goForward: (viewId) => {
        const wc = this.viewsById.get(viewId)?.view.webContents;
        if (wc?.navigationHistory.canGoForward())
          wc.navigationHistory.goForward();
      },
      send: (viewId, channel, payload) => {
        const wc = this.viewsById.get(viewId)?.view.webContents;
        if (wc && !wc.isDestroyed()) wc.send(channel, payload);
      },
      setVisible: (viewId, visible) => this.setViewVisible(viewId, visible),
      webContents: (viewId) =>
        this.viewsById.get(viewId)?.view.webContents ?? null,
    };

    this.theme = {
      read: () => this.currentTheme,
      write: (next) => {
        this.currentTheme = next;
        writeUserPreferences({ theme: next });
      },
      apply: (next) => this.applyTheme(next),
    };

    this.scene = {
      read: (wsId) => readScene(wsId),
      write: (wsId, scene) => writeScene(wsId, scene),
    };

    this.native = {
      openExternal: (url) => {
        void shell.openExternal(url);
      },
      openPath: (path) => {
        void shell.openPath(path);
      },
      pickDirectory: async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      pickSaveFile: async (input) => {
        const result = await dialog.showSaveDialog({
          ...(input.title ? { title: input.title } : {}),
          ...(input.defaultPath ? { defaultPath: input.defaultPath } : {}),
          ...(input.filters ? { filters: input.filters } : {}),
        });
        return result.canceled ? null : (result.filePath ?? null);
      },
      popupMenu: async (items) => {
        const result = await dialog.showMessageBox({
          type: 'question',
          message: '选择操作',
          detail: '请选择一项',
          buttons: items.map((item) => item.label),
          cancelId: -1,
          noLink: true,
        });
        return items[result.response]?.id ?? null;
      },
    };
  }

  /** URA 资源监听（插件页 / 资源页的 ura.watch 兼容入口）。 */
  setUraWatcher(
    watcher: (ref: string, onEvent: (event: unknown) => void) => () => void,
  ): void {
    this.uraWatcher = watcher;
  }

  install(ctx: MiddlewareContext): void {
    this.ctx = ctx;
    this.bindTransport(ctx.transport);
  }

  async activate(_ctx: MiddlewareContext): Promise<void> {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.focus();
      return;
    }
    this.harden(session.defaultSession);
    this.win = this.createWindow();
    this.buildMenu();
    this.log(
      `window: ready dev=${Boolean(process.env['ELECTRON_RENDERER_URL'])}`,
    );
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  attach(wc: WebContents): void {
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('will-attach-webview', (event) => event.preventDefault());
    wc.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    this.harden(wc.session);
    this.applyShellCsp(wc.session);
  }

  rendererUrl(page: string): string {
    const dev = process.env['ELECTRON_RENDERER_URL'];
    return dev
      ? `${dev.replace(/\/+$/, '')}/${page}`
      : pathToFileURL(rendererFile(page)).toString();
  }

  log(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      mkdirSync(join(this.dataRoot, 'logs'), { recursive: true });
      appendFileSync(this.bootLog, line);
    } catch {
      /* ignore */
    }
    console.log(`[app] ${message}`);
  }

  bindTransport(bindings: TransportBindings): void {
    bindTransportIpc(bindings, {
      originOf: (externalId) => bindings.originOf(externalId),
      onBus: (senderId, message) => {
        for (const [id, entry] of this.viewsById) {
          if (String(entry.view.webContents.id) !== senderId) continue;
          this.hooksById.get(id)?.onBus?.(message);
          break;
        }
      },
      watchUra: (ref, onEvent) =>
        this.uraWatcher ? this.uraWatcher(ref, onEvent) : null,
    });
  }
  // ─── 窗口 / 视图 ───────────────────────────────────────

  private bounds(): WindowBounds | null {
    if (!this.win || this.win.isDestroyed()) return null;
    const { width, height } = this.win.getContentBounds();
    return { width, height };
  }

  /** 屏幕 DIP 光标 → 窗口内容坐标（交互几何的唯一权威来源）。 */
  private cursor(): { x: number; y: number } | null {
    if (!this.win || this.win.isDestroyed()) return null;
    const point = screen.getCursorScreenPoint();
    const bounds = this.win.getContentBounds();
    return { x: point.x - bounds.x, y: point.y - bounds.y };
  }

  private addListener<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => set.delete(listener);
  }

  private createWindow(): BrowserWindow {
    const isMac = process.platform === 'darwin';
    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      backgroundColor: this.currentTheme === 'light' ? '#f4f4f5' : '#1a1c1d',
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      // 三键 / 红绿灯由系统绘制：macOS 走 hiddenInset + 位置微调；Windows / Linux
      // 隐藏标题栏后必须挂 WCO 覆盖层，否则连最小化 / 最大化 / 关闭都不存在。
      ...(isMac
        ? { trafficLightPosition: { x: 16, y: 12 } }
        : { titleBarOverlay: this.titleBarOverlay() }),
      webPreferences: {
        preload: preloadPath('workbench'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.attach(window.webContents);
    window.once('ready-to-show', () => window.show());
    window.on('resize', () => {
      if (this.layout) this.applyLayout(this.layout);
    });
    window.on('blur', () => {
      for (const listener of this.blurListeners) listener();
    });
    window.on('closed', () => {
      if (this.win === window) this.win = null;
      this.viewsById.clear();
    });
    void window.loadURL(this.rendererUrl('index.html'));
    return window;
  }

  private createView(input: NativeViewInput, hooks?: ViewHooks): number | null {
    if (!this.win || this.win.isDestroyed()) return null;
    const partition = input.partition;
    const target = partition ? session.fromPartition(partition) : null;
    if (target) this.harden(target);
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadFor(input.preload),
        ...(partition ? { partition } : {}),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win.contentView.addChildView(view);
    // 内容视图（页面 / 网页）底色透明：页面首帧之前看到的是壳层底色，不是白闪。
    if (
      input.type === 'page' ||
      input.type === 'web' ||
      input.type === 'overlay' ||
      input.type === 'capture'
    ) {
      view.setBackgroundColor('#00000000');
    }
    // 系统视图（对话框覆盖层 / 指针捕获层）按需出现：初始隐藏。
    // 内容视图不做初始隐藏——「隐藏 → 写几何 → 显示」会让 Windows 的原生视图
    // 失去首帧（见 setViewVisible）。
    if (input.type === 'overlay' || input.type === 'capture') {
      view.setVisible(false);
    }
    // 捕获层只上报指针事件；由交互控制器订阅。
    if (input.type === 'capture') {
      view.webContents.on('ipc-message', (_event, channel, payload) => {
        if (channel !== CH_CAPTURE) return;
        for (const listener of this.captureListeners) {
          listener(payload as CaptureMessage);
        }
      });
    }
    const entry: ViewEntry = { view, type: input.type };
    this.viewsById.set(input.viewId, entry);
    if (hooks) this.hooksById.set(input.viewId, hooks);
    view.webContents.on('did-finish-load', () => {
      // 首帧兜底：加载完成后再写一次几何（隐藏期设过几何的视图尤其需要）。
      if (this.viewsById.get(input.viewId) === entry) this.reapplyBounds(entry);
      hooks?.onReady?.();
    });
    view.webContents.on('render-process-gone', () => hooks?.onCrash?.());
    void view.webContents.loadURL(input.url);
    if (this.layout) this.applyLayout(this.layout);
    return view.webContents.id;
  }

  private closeView(viewId: string): void {
    const entry = this.viewsById.get(viewId);
    if (!entry) return;
    this.viewsById.delete(viewId);
    this.hooksById.delete(viewId);
    if (this.win && !this.win.isDestroyed()) {
      this.win.contentView.removeChildView(entry.view);
    }
    entry.view.webContents.close();
  }

  private activateView(viewId: string): void {
    for (const [id, entry] of this.viewsById) {
      if (entry.type === 'page' || entry.type === 'web') {
        this.setViewVisible(id, id === viewId);
      }
    }
    this.viewsById.get(viewId)?.view.webContents.focus();
  }

  /**
   * 显示 / 隐藏原生视图。
   *
   * 可见后补写一次几何：Windows 上「隐藏期间设过 bounds → 再 show」的原生视图
   * 不会重建合成面，表现为视图可见、几何正确却永远空白，直到下一次几何变化
   * （拖分隔条 / 改窗口大小）才出画面。macOS / Linux 在 show 时会重新合成，
   * 因此只有 Windows 会空白；这里补写几何对三者都无害。
   */
  private setViewVisible(viewId: string, visible: boolean): void {
    const entry = this.viewsById.get(viewId);
    if (!entry) return;
    entry.view.setVisible(visible);
    if (visible) this.reapplyBounds(entry);
  }

  private applyLayout(next: LayoutSnapshot): void {
    this.layout = next;
    for (const [id, entry] of this.viewsById) {
      const bounds = this.boundsFor(entry);
      if (bounds) entry.view.setBounds(bounds);
      // 助手可见性跟随 aiOpen：浮动态的几何不会归零，必须显式隐藏。
      if (
        entry.type === 'assistant' &&
        entry.view.getVisible() !== next.assistantVisible
      ) {
        this.setViewVisible(id, next.assistantVisible);
      }
    }
    this.applyAssistantChrome();
    this.applyStack();
  }

  /**
   * 助手视图外观：浮动态用透明底 + 原生圆角，圆角外透出下层内容而不是视图底色；
   * 停靠态用主题底色（加载期防白闪，页面根容器负责最终视觉）。
   */
  private applyAssistantChrome(): void {
    const layout = this.layout;
    if (!layout) return;
    const assistants = [...this.viewsById.values()].filter(
      (entry) => entry.type === 'assistant',
    );
    if (assistants.length === 0) return;
    const key = `${layout.assistantMode}:${this.currentTheme}`;
    if (key === this.assistantChromeKey) return;
    this.assistantChromeKey = key;
    const floating = layout.assistantMode === 'floating';
    for (const entry of assistants) {
      try {
        // 与渲染层 rounded-xl（12px）对齐；平台不支持时由页面圆角兜底。
        entry.view.setBorderRadius(floating ? 12 : 0);
      } catch {
        /* 平台不支持原生圆角 */
      }
      try {
        entry.view.setBackgroundColor(
          floating ? '#00000000' : themeBackground(this.currentTheme),
        );
      } catch {
        /* 平台不支持透明底 */
      }
    }
  }

  /**
   * 原生视图栈序：内容（page / web）→ 助手 → overlay → capture。
   *
   * WebContentsView 后挂的在上层；内容视图创建晚于系统视图，不重排会盖住
   * 浮动助手、对话框遮罩与指针捕获层。同一 view 重复 addChildView 会置顶，
   * 组成不变时按 key 跳过，避免无谓重排。
   */
  private applyStack(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const rank = (type: string): number =>
      type === 'assistant'
        ? 1
        : type === 'overlay'
          ? 2
          : type === 'capture'
            ? 3
            : 0;
    const order = [...this.viewsById.entries()].sort(
      ([, a], [, b]) => rank(a.type) - rank(b.type),
    );
    const key = order.map(([id]) => id).join('|');
    if (key === this.lastStackKey) return;
    this.lastStackKey = key;
    for (const [, entry] of order) {
      try {
        win.contentView.addChildView(entry.view);
      } catch {
        /* 视图已销毁 */
      }
    }
  }

  private reapplyBounds(entry: ViewEntry): void {
    const bounds = this.boundsFor(entry);
    if (bounds) entry.view.setBounds(bounds);
  }

  /** 视图在当前布局下的几何：类型决定取哪块区域。 */
  private boundsFor(entry: ViewEntry): Rectangle | null {
    const layout = this.layout;
    if (!layout) return null;
    const rect =
      entry.type === 'assistant'
        ? layout.assistantMode === 'floating'
          ? layout.assistantFloating
          : layout.assistantDock
        : entry.type === 'overlay' || entry.type === 'capture'
          ? layout.overlay
          : layout.resourceContent;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  private preloadFor(preload: ViewPreload | undefined): string | undefined {
    if (!preload || preload === 'none') return undefined;
    if (preload === 'page') return preloadPath('extension');
    if (preload === 'web') return preloadPath('browser');
    return preloadPath(preload);
  }

  // ─── 策略 ─────────────────────────────────────────────

  private harden(target: Session): void {
    hardenSession(target, this.pageSessions);
  }

  /** CSP 只作用于工作台壳层；app:// 设置/插件页与浏览器页不套壳层 CSP。 */
  private applyShellCsp(target: Session): void {
    applyShellCsp(target, Boolean(process.env['ELECTRON_RENDERER_URL']));
  }

  private applyTheme(next: Theme): void {
    this.currentTheme = next;
    nativeTheme.themeSource = next === 'light' ? 'light' : 'dark';
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBackgroundColor(next === 'light' ? '#f4f4f5' : '#1a1c1d');
      // 原生三键由覆盖层绘制，配色不随 nativeTheme 自动更新，需显式同步。
      this.applyTitleBarOverlay(this.win);
    }
    this.applyAssistantChrome();
  }

  /** WCO 覆盖层参数：配色与渲染层标题栏同源，高度与 DOM 标题栏同高。 */
  private titleBarOverlay(): TitleBarOverlay {
    const colors =
      this.currentTheme === 'light'
        ? TITLEBAR_OVERLAY_COLORS.light
        : TITLEBAR_OVERLAY_COLORS.dark;
    return { ...colors, height: TITLEBAR_HEIGHT };
  }

  /**
   * 重设覆盖层（macOS 无覆盖层，红绿灯由系统跟随 nativeTheme）。
   * 桌面环境不支持 WCO 时不抛错：渲染层按 TITLEBAR_FALLBACK_INSET 排布留白。
   */
  private applyTitleBarOverlay(target: BrowserWindow): void {
    if (process.platform === 'darwin') return;
    try {
      target.setTitleBarOverlay(this.titleBarOverlay());
    } catch {
      /* 平台 / 桌面环境不支持 WCO */
    }
  }

  private buildMenu(): void {
    const isMac = process.platform === 'darwin';
    const template: MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          {
            label: '重载当前视图',
            accelerator: 'CmdOrCtrl+R',
            click: () => {
              const wc = this.win?.webContents;
              if (wc && !wc.isDestroyed()) wc.reload();
            },
          },
          {
            label: '开发者工具',
            accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => {
              const wc = this.win?.webContents;
              if (!wc || wc.isDestroyed()) return;
              if (wc.isDevToolsOpened()) wc.closeDevTools();
              else wc.openDevTools({ mode: 'right' });
            },
          },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}
