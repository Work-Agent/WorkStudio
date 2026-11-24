/**
 * native 组件：窗口、主题、现场、系统动作。
 *
 * 四个 App 内置组件都直接绑定 Electron / 文件系统；它们共享 native
 * 这一角色，所以放在同一个模块。规模变大再拆。
 */

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  screen,
  shell,
} from 'electron';
import type {
  BaseWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
  OpenDialogOptions,
  Point,
  Rectangle,
  SaveDialogOptions,
  TitleBarOverlay,
  WebContents,
  WebPreferences,
} from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  TITLEBAR_HEIGHT,
  TITLEBAR_OVERLAY_COLORS,
} from '../../../shared/titlebar.ts';
import { hardenWebContents } from '../../runtime/policy.ts';
import { GlobalViews, Tabs } from './views.ts';
import type {
  LayoutSnapshot,
  NativeScene,
  Theme,
  ThemeSource,
} from '../../runtime/shared.ts';

export interface WindowOptions {
  width?: number;
  height?: number;
  /** 默认 true；false 表示保持隐藏，不由 load 自动显示。 */
  show?: boolean;
  webPreferences?: WebPreferences;
  browserWindow?: BrowserWindowConstructorOptions;
  /** 窗口底色与原生三键配色的依据；由 WindowManager 按当前主题传入。 */
  theme?: Theme;
}

/** 壳层首帧底色：与工作台皮肤一致，避免深色主题下先闪白。 */
const WINDOW_BACKGROUND: Record<Theme, string> = {
  light: '#f4f4f5',
  dark: '#1a1c1d',
};

/** WCO 覆盖层：配色与渲染层标题栏同源，高度与 DOM 标题栏一致。 */
function titleBarOverlay(theme: Theme): TitleBarOverlay {
  return {
    ...(theme === 'light'
      ? TITLEBAR_OVERLAY_COLORS.light
      : TITLEBAR_OVERLAY_COLORS.dark),
    height: TITLEBAR_HEIGHT,
  };
}

/** 所有 webContents 共用的导航 / 权限策略（与 main 的 ElectronCapability.attach 一致）。 */

export class AppWindow {
  private readonly options: WindowOptions;
  protected theme: Theme;
  private win: BrowserWindow | null = null;
  private readonly loadedListeners = new Set<() => void>();
  private readonly closedListeners = new Set<() => void>();
  private readonly resizeListeners = new Set<() => void>();

  constructor(options: WindowOptions = {}) {
    this.options = options;
    this.theme =
      options.theme ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }

  close(): void {
    const win = this.alive();
    this.win = null;
    win?.close();
  }

  /** 调用方需保证 Electron 已 ready。 */
  open(): BrowserWindow {
    const current = this.alive();
    if (current) return current;

    const isMac = process.platform === 'darwin';
    const theme = this.theme;
    const { webPreferences: overridePreferences, ...windowOptions } =
      this.options.browserWindow ?? {};
    const created = new BrowserWindow({
      width: this.options.width ?? 1440,
      height: this.options.height ?? 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      backgroundColor: WINDOW_BACKGROUND[theme],
      // 三键 / 红绿灯由系统绘制：macOS 走 hiddenInset + 位置微调；
      // Windows / Linux 隐藏标题栏后必须挂 WCO 覆盖层，否则没有最小化 / 最大化 / 关闭。
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      ...(isMac
        ? { trafficLightPosition: { x: 16, y: 12 } }
        : { titleBarOverlay: titleBarOverlay(theme) }),
      ...windowOptions,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        ...this.options.webPreferences,
        ...overridePreferences,
      },
    });
    hardenWebContents(created.webContents);

    created.webContents.on('did-finish-load', () => {
      for (const listener of Array.from(this.loadedListeners)) listener();
    });
    created.on('resize', () => {
      for (const listener of Array.from(this.resizeListeners)) listener();
    });
    created.on('closed', () => {
      if (this.win === created) this.win = null;
      for (const listener of Array.from(this.closedListeners)) listener();
    });

    this.win = created;
    return created;
  }

  current(): BrowserWindow | null {
    return this.alive();
  }

  load(url: string): void {
    const current = this.alive();
    if (!current) return;
    if (this.options.show !== false) {
      current.once('ready-to-show', () => {
        if (!current.isDestroyed()) current.show();
      });
    }
    void current.loadURL(url);
  }

  show(): void {
    this.alive()?.show();
  }

  focus(): void {
    this.alive()?.focus();
  }

  bounds(): Rectangle | null {
    return this.alive()?.getContentBounds() ?? null;
  }

  cursor(): { x: number; y: number } | null {
    const current = this.alive();
    if (!current) return null;
    const bounds = current.getContentBounds();
    const point = screen.getCursorScreenPoint();
    return { x: point.x - bounds.x, y: point.y - bounds.y };
  }

  webContentsId(): number | null {
    return this.alive()?.webContents.id ?? null;
  }

  send(channel: string, payload: unknown): void {
    this.alive()?.webContents.send(channel, payload);
  }

  onLoaded(listener: () => void): () => void {
    this.loadedListeners.add(listener);
    return () => {
      this.loadedListeners.delete(listener);
    };
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => {
      this.resizeListeners.delete(listener);
    };
  }

  onClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => {
      this.closedListeners.delete(listener);
    };
  }

  /** 直接设置窗口内容区（平台级几何入口；布局由 WorkspaceWindow 负责）。 */
  setContentBounds(bounds: Rectangle): void {
    this.alive()?.setContentBounds(bounds);
  }

  /** 主题切换：同步窗口底色与 WCO 覆盖层（macOS 红绿灯由 nativeTheme 跟随）。 */
  applyTheme(theme: Theme): void {
    this.theme = theme;
    const win = this.alive();
    if (!win) return;
    win.setBackgroundColor(WINDOW_BACKGROUND[theme]);
    if (process.platform === 'darwin') return;
    try {
      win.setTitleBarOverlay(titleBarOverlay(theme));
    } catch {
      /* 平台 / 桌面环境不支持 WCO */
    }
  }

  protected alive(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }
}

export class WorkspaceWindow extends AppWindow {
  readonly wsId: string;
  /** 窗口级系统视图：shell / assistant / overlay / capture。 */
  readonly global: GlobalViews;
  /** 资源面板标签：page / web。 */
  readonly tabs: Tabs;
  windowId = 0;
  private layout: LayoutSnapshot | null = null;
  private stackKey = '';
  private chromeKey = '';

  constructor(wsId: string, options: WindowOptions = {}) {
    super(options);
    this.wsId = wsId;
    this.global = new GlobalViews(this);
    this.tabs = new Tabs(this);
  }

  /** 窗口创建即注册 shell；shell 只是 GlobalViews 里的一条记录。 */
  override open(): BrowserWindow {
    const window = super.open();
    this.global.attachShell();
    this.attachShortcuts(window.webContents);
    return window;
  }

  /** 新 tab 创建后补写当前内容区几何（不等待下一次 layout 发布）。 */
  applyTabLayout(): void {
    if (this.layout) this.tabs.setUniformBounds(this.layout.resourceContent);
  }

  /** 把布局快照落实到原生视图：内容区 / 助手 / 浮层 / 捕获层。 */
  applyLayout(layout: LayoutSnapshot): void {
    this.layout = layout;
    this.tabs.setUniformBounds(layout.resourceContent);
    for (const record of this.global.list()) {
      const rect =
        record.type === 'assistant'
          ? layout.assistantMode === 'floating'
            ? layout.assistantFloating
            : layout.assistantDock
          : record.type === 'overlay'
            ? layout.overlay
            : record.type === 'capture'
              ? layout.capture
              : null;
      if (rect) this.global.setBounds(record.id, rect);
      if (record.type === 'assistant')
        this.global.show(record.id, layout.assistantVisible);
    }
    this.applyAssistantChrome(layout);
    this.applyStack();
  }

  override applyTheme(theme: Theme): void {
    super.applyTheme(theme);
    if (this.layout) this.applyAssistantChrome(this.layout);
  }

  /** 助手外观：浮动态透明底 + 原生圆角；停靠态主题底色。 */
  private applyAssistantChrome(layout: LayoutSnapshot): void {
    const assistants = this.global
      .list()
      .filter((record) => record.type === 'assistant');
    if (assistants.length === 0) return;
    const floating = layout.assistantMode === 'floating';
    const key = `${layout.assistantMode}:${this.theme}`;
    if (key === this.chromeKey) return;
    this.chromeKey = key;
    for (const record of assistants) {
      const view = this.global.nativeView(record.id);
      if (!view) continue;
      try {
        view.setBorderRadius(floating ? 12 : 0);
      } catch {
        /* 平台不支持原生圆角 */
      }
      try {
        view.setBackgroundColor(
          floating ? '#00000000' : WINDOW_BACKGROUND[this.theme],
        );
      } catch {
        /* 平台不支持透明底 */
      }
    }
  }

  /** 原生视图栈序：内容 → 助手 → overlay → capture。 */
  private applyStack(): void {
    const win = this.alive();
    if (!win) return;
    const rank = (type: string): number =>
      type === 'assistant'
        ? 1
        : type === 'overlay'
          ? 2
          : type === 'capture'
            ? 3
            : 0;
    const views = [...this.tabs.all(), ...this.global.list()]
      .filter((record) => record.type !== 'shell')
      .sort((a, b) => rank(a.type) - rank(b.type));
    const key = views.map((record) => record.id).join('|');
    if (key === this.stackKey) return;
    this.stackKey = key;
    for (const record of views) {
      const view =
        this.tabs.get(record.id) !== null
          ? this.tabs.nativeView(record.id)
          : this.global.nativeView(record.id);
      if (!view) continue;
      try {
        win.contentView.addChildView(view);
      } catch {
        /* 视图已销毁 */
      }
    }
  }

  /** 基本标签快捷键：Cmd/Ctrl+W 关闭激活视图，Cmd/Ctrl+1..9 激活第 N 个。 */
  private attachShortcuts(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!(input.meta || input.control) || input.alt) return;
      const key = input.key.toLowerCase();
      if (key === 'w') {
        const active = this.tabs.activeViewId();
        if (!active) return;
        event.preventDefault();
        this.tabs.remove(active);
        return;
      }
      const digit = Number.parseInt(key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const target = this.tabs.all()[digit - 1];
      if (!target) return;
      event.preventDefault();
      this.tabs.activate(target.id);
    });
  }
}

/** 一个工作区最多一个窗口：wsId → WorkspaceWindow。 */
export class WindowManager {
  private readonly byWorkspace = new Map<string, WorkspaceWindow>();
  private readonly byWindow = new Map<number, WorkspaceWindow>();
  private readonly openListeners = new Set<(window: WorkspaceWindow) => void>();
  private readonly closeListeners = new Set<
    (window: WorkspaceWindow) => void
  >();
  private last: WorkspaceWindow | null = null;
  private lastWsId: string | null = null;

  constructor(private readonly theme: () => Theme = () => 'dark') {}

  closeAll(): void {
    for (const window of this.byWorkspace.values()) {
      window.close();
      this.forget(window);
    }
    this.byWorkspace.clear();
    this.byWindow.clear();
    this.last = null;
    this.lastWsId = null;
  }

  open(wsId: string, options: WindowOptions = {}): WorkspaceWindow {
    const existing = this.byWorkspace.get(wsId);
    if (existing) {
      existing.focus();
      this.last = existing;
      this.lastWsId = wsId;
      return existing;
    }

    const window = new WorkspaceWindow(wsId, {
      ...options,
      theme: this.theme(),
    });
    try {
      const win = window.open();
      window.windowId = win.id;
    } catch (error) {
      window.close();
      throw error;
    }
    this.byWorkspace.set(wsId, window);
    this.byWindow.set(window.windowId, window);
    this.last = window;
    this.lastWsId = wsId;
    window.onClosed(() => this.forget(window));
    for (const listener of Array.from(this.openListeners)) listener(window);
    return window;
  }

  get(wsId: string): WorkspaceWindow | null {
    return this.byWorkspace.get(wsId) ?? null;
  }

  byWindowId(windowId: number): WorkspaceWindow | null {
    return this.byWindow.get(windowId) ?? null;
  }

  list(): WorkspaceWindow[] {
    return [...this.byWorkspace.values()];
  }

  active(): WorkspaceWindow | null {
    return this.last && this.byWindow.has(this.last.windowId)
      ? this.last
      : null;
  }

  get lastWorkspaceId(): string | null {
    return this.active()?.wsId ?? this.lastWsId;
  }

  focus(wsId: string): void {
    const window = this.byWorkspace.get(wsId);
    if (!window) return;
    window.focus();
    this.last = window;
    this.lastWsId = wsId;
  }

  close(wsId: string): void {
    const window = this.byWorkspace.get(wsId);
    if (!window) return;
    window.close();
    this.forget(window);
  }

  onOpen(listener: (window: WorkspaceWindow) => void): () => void {
    this.openListeners.add(listener);
    return () => {
      this.openListeners.delete(listener);
    };
  }

  onClose(listener: (window: WorkspaceWindow) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  private forget(window: WorkspaceWindow): void {
    if (!this.byWindow.has(window.windowId)) return;
    if (this.byWorkspace.get(window.wsId) === window) {
      this.byWorkspace.delete(window.wsId);
    }
    this.byWindow.delete(window.windowId);
    if (this.last === window) {
      this.last = this.byWorkspace.values().next().value ?? null;
    }
    for (const listener of Array.from(this.closeListeners)) listener(window);
  }
}

const systemTheme = (): Theme =>
  nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

export class ThemeManager {
  /** 持久化的主题来源；现状由 nativeTheme.themeSource 承载。 */
  private source: ThemeSource = 'system';
  /** 当前有效主题；system 模式下随操作系统变化。 */
  private current: Theme = systemTheme();
  private offUpdated: (() => void) | null = null;
  private readonly listeners = new Set<(theme: Theme) => void>();

  bind(): void {
    this.sync();
    nativeTheme.themeSource = this.source;
    nativeTheme.on('updated', this.onUpdated);
    this.offUpdated = () =>
      nativeTheme.removeListener('updated', this.onUpdated);
  }

  unbind(): void {
    this.offUpdated?.();
    this.offUpdated = null;
  }

  readSource(): ThemeSource {
    return this.source;
  }

  read(): Theme {
    return this.current;
  }

  subscribe(listener: (theme: Theme) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(source: ThemeSource): void {
    if (source !== 'light' && source !== 'dark' && source !== 'system') {
      throw new Error('theme source must be light, dark or system');
    }
    const sourceChanged = source !== this.source;
    this.source = source;
    nativeTheme.themeSource = source;
    const themeChanged = this.sync();
    // 来源改变但有效主题不变时，system domain 仍需拿到 themeSource。
    if (sourceChanged && !themeChanged) this.notify();
  }

  private readonly onUpdated = (): void => {
    this.sync();
  };

  /** 有效主题变化时通知；返回是否发生变化。 */
  private sync(): boolean {
    const next = systemTheme();
    if (next === this.current) return false;
    this.current = next;
    this.notify();
    return true;
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener(this.current);
  }
}

export interface SceneOptions {
  root?: string;
}

function safeId(wsId: string): string {
  return wsId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
}

export class Scene {
  private readonly options: SceneOptions;

  constructor(options: SceneOptions = {}) {
    this.options = options;
  }

  read(wsId: string): NativeScene | null {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(this.fileOf(wsId), 'utf8'),
      );
      return parsed && typeof parsed === 'object'
        ? (parsed as NativeScene)
        : null;
    } catch {
      return null;
    }
  }

  write(wsId: string, scene: NativeScene): void {
    const file = this.fileOf(wsId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(scene, null, 2), 'utf8');
  }

  private fileOf(wsId: string): string {
    const root = this.options.root ?? join(app.getPath('userData'), 'scenes');
    return join(root, safeId(wsId), 'scene.json');
  }
}

export interface SaveFileOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export class SystemActions {
  private readonly windows: WindowManager;
  private move: {
    win: BrowserWindow;
    bounds: Rectangle;
    point: Point;
    restoreSingleSpace: boolean;
  } | null = null;

  constructor(windows: WindowManager) {
    this.windows = windows;
  }

  /** 窗口位移使用全局屏幕 DIP，不受视图边界或当前显示器约束。 */
  beginWindowMove(wsId: string): boolean {
    const win = this.windows.get(wsId)?.current();
    if (!win || win.isDestroyed() || win.isFullScreen() || win.isMaximized())
      return false;
    this.endWindowMove();
    const restoreSingleSpace =
      process.platform === 'darwin' && !win.isVisibleOnAllWorkspaces();
    // 拖动期间跨越当前桌面空间；松手后重新归属目标屏幕。
    if (restoreSingleSpace)
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    this.move = {
      win,
      bounds: win.getBounds(),
      point: screen.getCursorScreenPoint(),
      restoreSingleSpace,
    };
    return true;
  }

  updateWindowMove(): boolean {
    const move = this.move;
    if (!move || move.win.isDestroyed()) return false;
    const point = screen.getCursorScreenPoint();
    move.win.setBounds(
      {
        ...move.bounds,
        x: Math.round(move.bounds.x + point.x - move.point.x),
        y: Math.round(move.bounds.y + point.y - move.point.y),
      },
      false,
    );
    return true;
  }

  endWindowMove(): void {
    const move = this.move;
    if (!move) return;
    this.updateWindowMove();
    this.move = null;
    if (move.restoreSingleSpace && !move.win.isDestroyed()) {
      move.win.setVisibleOnAllWorkspaces(false, {
        skipTransformProcessType: true,
      });
      move.win.focus();
    }
  }

  openExternal(url: string): void {
    void shell.openExternal(url);
  }

  openPath(path: string): void {
    void shell.openPath(path);
  }

  async pickDirectory(wsId?: string): Promise<string | null> {
    const options: OpenDialogOptions = { properties: ['openDirectory'] };
    const win = this.parent(wsId);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async pickSaveFile(
    wsId: string | null,
    input: SaveFileOptions,
  ): Promise<string | null> {
    const options: SaveDialogOptions = {
      ...(input.title ? { title: input.title } : {}),
      ...(input.defaultPath ? { defaultPath: input.defaultPath } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
    };
    const win = this.parent(wsId);
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  }

  popupMenu(wsId: string | null, items: MenuItem[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let selected: string | null = null;
      const template: MenuItemConstructorOptions[] = items.map((item) => ({
        label: item.label,
        enabled: !item.disabled,
        click: () => {
          selected = item.id;
        },
      }));
      const menu = Menu.buildFromTemplate(template);
      const win = this.parent(wsId);
      menu.popup({
        ...(win ? { window: win } : {}),
        callback: () => resolve(selected),
      });
    });
  }

  private parent(wsId?: string | null): BaseWindow | null {
    const window = wsId ? this.windows.get(wsId) : this.windows.active();
    return window?.current() ?? null;
  }
}
