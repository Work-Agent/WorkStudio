/**
 * Electron shell 宿主：窗口与 WebContentsView 的唯一具体实现。
 *
 * 不定义 Host interface；domain 直接依赖这个具体类。它只做平台动作，
 * 不持有业务状态，窗口/视图投影仍由 shell 聚合状态维护。
 */

import {
  BrowserWindow,
  Menu,
  WebContentsView,
  clipboard,
  dialog,
  nativeTheme,
  screen,
  shell,
} from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';
import type { Origins } from '../../ipc/origins.ts';
import type { ViewType } from '../../contract.ts';
import { fileURLToPath } from 'node:url';
import type { LayoutSnapshot } from '../../../shared/types.ts';
import { defaultLayout } from './layout.ts';
import {
  TITLEBAR_HEIGHT,
  TITLEBAR_OVERLAY_COLORS,
} from '../../../shared/titlebar.ts';
import { hardenWebContents } from '../../platform/policy.ts';
import { parsePluginUrl } from '../../../shared/pages.ts';
import { capturePage, waitForPageReady } from './capture-script.ts';
import { WORKSPACE_ARG } from '../../../shared/channels.ts';
import type { ViewRecord, WindowRecord } from './domains.ts';

export interface ShellWindowOptions {
  width?: number;
  height?: number;
  show?: boolean;
  browserWindow?: BrowserWindowConstructorOptions;
  theme?: 'light' | 'dark';
}

export interface ShellHostOptions {
  origins: Origins;
  preload?: string;
  capturePreload?: string;
  shellUrl?: string;
  assistantUrl?: string;
  overlayUrl?: string;
  welcomeUrl?: string;
  captureUrl?: string;
  window?: ShellWindowOptions;
}

export interface ViewOpenInput {
  id?: string;
  type: ViewType;
  title: string;
  url?: string;
}

interface WindowEntry {
  record: WindowRecord;
  window: BrowserWindow;
  senderId: string;
}

interface ViewEntry {
  record: ViewRecord;
  view: WebContentsView;
  window: BrowserWindow;
  windowId: string;
  senderId: string;
  /** 网页要等首个文档就绪再显示：Chromium 初始白底会盖住主题底色。 */
  ready: boolean;
}

type Rect = { x: number; y: number; width: number; height: number };

/** OAuth 授权回传地址：本机回调路径或带 code 参数。 */
function isLoopbackCallback(value: string): boolean {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      /(?:^|\/)callback$/i.test(url.pathname) || url.searchParams.has('code')
    );
  } catch {
    return false;
  }
}

export class ShellHost {
  private readonly windows = new Map<string, WindowEntry>();
  /** key = `${windowId}\u0000${viewId}`：同一 contentPath 可在不同窗口各自成页。 */
  private readonly views = new Map<string, ViewEntry>();
  private readonly byWorkspace = new Map<string, string>();
  private readonly windowClosedListeners = new Set<(id: string) => void>();
  private readonly viewClosedListeners = new Set<
    (windowId: string, viewId: string) => void
  >();
  private readonly windowActivatedListeners = new Set<(id: string) => void>();
  private readonly windowResizedListeners = new Set<(id: string) => void>();
  private readonly layouts = new Map<string, LayoutSnapshot>();
  private seq = 0;

  private static viewKey(windowId: string, viewId: string): string {
    return `${windowId}\u0000${viewId}`;
  }

  private viewOf(windowId: string, viewId: string): ViewEntry | undefined {
    return this.views.get(ShellHost.viewKey(windowId, viewId));
  }

  constructor(private readonly options: ShellHostOptions) {}

  onWindowClosed(listener: (id: string) => void): () => void {
    this.windowClosedListeners.add(listener);
    return () => this.windowClosedListeners.delete(listener);
  }

  onWindowResized(listener: (id: string) => void): () => void {
    this.windowResizedListeners.add(listener);
    return () => this.windowResizedListeners.delete(listener);
  }

  onViewClosed(
    listener: (windowId: string, viewId: string) => void,
  ): () => void {
    this.viewClosedListeners.add(listener);
    return () => this.viewClosedListeners.delete(listener);
  }

  onWindowActivated(listener: (id: string) => void): () => void {
    this.windowActivatedListeners.add(listener);
    return () => this.windowActivatedListeners.delete(listener);
  }

  openWindow(workspaceId: string): WindowRecord {
    const existingId = this.byWorkspace.get(workspaceId);
    const existing = existingId ? this.windows.get(existingId) : null;
    if (existing) {
      existing.window.focus();
      return existing.record;
    }
    const isMac = process.platform === 'darwin';
    const theme =
      this.options.window?.theme ??
      (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    const background = theme === 'dark' ? '#1a1c1d' : '#f4f4f5';
    const window = new BrowserWindow({
      width: this.options.window?.width ?? 1440,
      height: this.options.window?.height ?? 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'WorkStudio',
      backgroundColor: background,
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      ...(isMac
        ? {
            // 40px 标题栏：12px 原生按钮垂直居中；20px 与系统窗口边距一致。
            trafficLightPosition: { x: 20, y: 14 },
          }
        : {
            titleBarOverlay: {
              ...(theme === 'light'
                ? TITLEBAR_OVERLAY_COLORS.light
                : TITLEBAR_OVERLAY_COLORS.dark),
              height: TITLEBAR_HEIGHT,
            },
          }),
      ...this.options.window?.browserWindow,
      webPreferences: {
        ...(this.options.preload ? { preload: this.options.preload } : {}),
        contextIsolation: true,
        sandbox: true,
        additionalArguments: [`${WORKSPACE_ARG}${workspaceId}`],
        ...this.options.window?.browserWindow?.webPreferences,
      },
    });
    hardenWebContents(window.webContents);
    if (this.options.window?.show !== false) {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) window.show();
      });
    }
    const id = workspaceId;
    const record: WindowRecord = { id, workspaceId, active: true };
    const senderId = String(window.webContents.id);
    this.windows.set(id, { record, window, senderId });
    this.byWorkspace.set(workspaceId, id);
    this.registerShellOrigin(senderId, id);
    window.on('focus', () => this.activateWindow(id));
    window.on('resize', () => {
      for (const listener of this.windowResizedListeners) listener(id);
      this.resizeWindow(id);
    });
    window.on('closed', () => this.forgetWindow(id));
    if (this.options.shellUrl) void window.loadURL(this.options.shellUrl);
    if (this.options.assistantUrl) {
      this.mountView(
        this.windows.get(id)!,
        {
          id: `assistant:${workspaceId}`,
          type: 'assistant',
          title: 'AI 助手',
          url: this.options.assistantUrl,
        },
        false,
      );
    }
    if (this.options.overlayUrl) {
      this.mountView(
        this.windows.get(id)!,
        {
          id: `overlay:${workspaceId}`,
          type: 'overlay',
          title: '对话框',
          url: this.options.overlayUrl,
        },
        false,
      );
    }
    if (this.options.captureUrl) {
      this.mountView(
        this.windows.get(id)!,
        {
          id: `capture:${workspaceId}`,
          type: 'capture',
          title: '捕获层',
          url: this.options.captureUrl,
        },
        false,
      );
    }
    return record;
  }

  openWelcome(windowId: string): ViewRecord | null {
    if (!this.options.welcomeUrl) return null;
    const windowEntry = this.windows.get(windowId);
    if (!windowEntry) return null;
    const existing = this.viewOf(windowId, 'welcome');
    if (existing) {
      this.activateView(windowId, 'welcome');
      return existing.record;
    }
    return this.mountView(
      windowEntry,
      {
        id: 'welcome',
        type: 'page',
        title: '欢迎',
        url: this.options.welcomeUrl,
      },
      true,
    );
  }

  focusWindow(id: string): void {
    this.windows.get(id)?.window.focus();
  }

  windowSize(id: string): { width: number; height: number } | null {
    const entry = this.windows.get(id);
    if (!entry || entry.window.isDestroyed()) return null;
    const [width = 0, height = 0] = entry.window.getContentSize();
    return { width, height };
  }

  async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async pickFile(extensions: string[] = []): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      ...(extensions.length > 0
        ? { filters: [{ name: '文件', extensions }] }
        : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async openPath(path: string): Promise<void> {
    await shell.openPath(path);
  }

  /** 在系统文件管理器中定位；只接受 file:// 引用。 */
  revealRef(ref: string): void {
    shell.showItemInFolder(fileURLToPath(ref));
  }

  /** 复制文件路径到剪贴板；只接受 file:// 引用。 */
  copyPath(ref: string): void {
    clipboard.writeText(fileURLToPath(ref));
  }

  /** 保存对话框：只返回用户选定的目标路径，是否真的写入由调用方决定。 */
  async showSaveDialog(defaultName?: string): Promise<string | null> {
    const options = {
      title: '保存文件',
      ...(defaultName ? { defaultPath: defaultName } : {}),
    };
    const window =
      BrowserWindow.getFocusedWindow() ??
      [...this.windows.values()].find((entry) => !entry.window.isDestroyed())
        ?.window;
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  }

  /** 仅 http(s)：file/work/plugin 等协议一律不交给系统浏览器。 */
  async openExternal(url: string): Promise<void> {
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开网页链接');
    await shell.openExternal(url);
  }

  popupMenu(
    items: Array<{ id: string; label: string; disabled?: boolean }>,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const menu = Menu.buildFromTemplate(
        items.map((item) => ({
          label: item.label,
          enabled: item.disabled !== true,
          click: () => resolve(item.id),
        })),
      );
      menu.popup({ callback: () => resolve(null) });
    });
  }

  windowCursor(id: string): { x: number; y: number } | null {
    const entry = this.windows.get(id);
    if (!entry || entry.window.isDestroyed()) return null;
    const bounds = entry.window.getContentBounds();
    const point = screen.getCursorScreenPoint();
    return { x: point.x - bounds.x, y: point.y - bounds.y };
  }

  closeWindow(id: string): void {
    this.windows.get(id)?.window.close();
  }

  listWindows(): WindowRecord[] {
    return [...this.windows.values()].map((entry) => entry.record);
  }

  activeWindow(): string | null {
    for (const [id, entry] of this.windows) {
      if (entry.window.isFocused()) return id;
    }
    return this.windows.keys().next().value ?? null;
  }

  openView(windowId: string, input: ViewOpenInput): ViewRecord {
    const windowEntry = this.windows.get(windowId);
    if (!windowEntry) throw new Error(`没有可用的工作区窗口：${windowId}`);
    return this.mountView(windowEntry, input, true);
  }

  private mountView(
    windowEntry: WindowEntry,
    input: ViewOpenInput,
    activate: boolean,
  ): ViewRecord {
    const windowId = windowEntry.record.id;
    const existing = input.id ? this.viewOf(windowId, input.id) : undefined;
    if (existing) {
      if (activate) this.activateView(windowId, existing.record.id);
      return existing.record;
    }
    const id = input.id ?? `view-${++this.seq}`;
    const dev = Boolean(process.env['ELECTRON_RENDERER_URL']);
    const view = new WebContentsView({
      webPreferences: {
        ...(input.type === 'capture'
          ? this.options.capturePreload
            ? { preload: this.options.capturePreload }
            : {}
          : input.type !== 'web' && this.options.preload
            ? { preload: this.options.preload }
            : {}),
        contextIsolation: true,
        sandbox: true,
        additionalArguments: [
          `${WORKSPACE_ARG}${windowEntry.record.workspaceId}`,
        ],
        ...(dev ? { webSecurity: false } : {}),
      },
    });
    const record: ViewRecord = {
      id,
      type: input.type,
      title: input.title,
      ...(input.url ? { url: input.url } : {}),
      active: activate,
      dirty: false,
      pinned: false,
    };
    if (activate) {
      for (const entry of this.views.values()) {
        if (entry.windowId !== windowId) continue;
        if (entry.record.type !== 'page' && entry.record.type !== 'web') {
          continue;
        }
        // 宿主自己的 active 标记要和壳层记录同步，否则等待加载时会露出旧页面。
        entry.record.active = false;
        entry.view.setVisible(false);
      }
    }
    if (input.type === 'overlay' || input.type === 'capture') {
      // 对话框 / 捕获层是覆盖在壳层之上的透明层，不能用自己的底色盖住页面。
      view.setBackgroundColor('#00000000');
      view.setVisible(false);
    } else if (input.type === 'web') {
      // 外部站点自己决定页面底色；透明页面露出的是浏览器的白底，不是应用主题色。
      view.setBackgroundColor('#ffffff');
    } else {
      // WebContentsView 默认白底；深色模式下新页面首帧会先露出白色。
      view.setBackgroundColor(this.backgroundColor());
    }
    windowEntry.window.contentView.addChildView(view);
    const senderId = String(view.webContents.id);
    const entry: ViewEntry = {
      record,
      view,
      window: windowEntry.window,
      windowId,
      senderId,
      ready: input.type !== 'web',
    };
    this.views.set(ShellHost.viewKey(windowId, id), entry);
    this.resizeWindow(windowEntry.record.id);
    // 插件页身份只从 URL 推导；页面自身与页面来源都改不了它。
    const pluginUrl = input.url ? parsePluginUrl(input.url) : null;
    const pluginId = pluginUrl?.id;
    this.options.origins.register(senderId, {
      type: 'view',
      viewId: id,
      viewType: input.type,
      workspaceId: windowEntry.record.workspaceId,
      ...(pluginId ? { pluginId } : {}),
      ...(pluginUrl?.ref ? { ref: pluginUrl.ref } : {}),
    });
    if (input.type === 'web') {
      // OAuth loopback 回调命中后收尾：给服务一点时间响应，再关标签页。
      // 只认回调路径 / 带 code 的地址——不能把本地开发的普通页面一起关掉。
      view.webContents.on('did-navigate', (_event: unknown, url: string) => {
        if (!isLoopbackCallback(url)) return;
        setTimeout(() => this.closeView(windowId, id), 1200);
      });
    }
    hardenWebContents(view.webContents, {
      allowNavigation: (url) => {
        if (input.type === 'web') {
          return /^https?:/i.test(url);
        }
        if (pluginId) return parsePluginUrl(url)?.id === pluginId;
        // 系统页：正式包只走 work://；开发模式下页面地址是 dev server。
        return url.startsWith('work://') || (dev && /^https?:/i.test(url));
      },
      // 网页的 target=_blank / window.open 留在应用内，开临时标签。
      ...(input.type === 'web'
        ? {
            onWindowOpen: (url: string): boolean => {
              if (!/^https?:/i.test(url)) return true;
              this.openView(windowEntry.record.id, {
                type: 'web',
                title: url,
                url,
              });
              return true;
            },
          }
        : {}),
    });
    view.webContents.on('destroyed', () => {
      this.options.origins.remove(senderId);
      const key = ShellHost.viewKey(windowId, id);
      // 关闭后立刻用同一 id 重开时，新视图已经登记；迟到的 destroyed 不能删掉新条目。
      if (this.views.get(key) !== entry) return;
      this.views.delete(key);
      for (const listener of this.viewClosedListeners) listener(windowId, id);
    });
    if (input.type === 'web') {
      // 外部网页的第一个文档是浏览器默认白底：先隐藏，dom-ready 后再显示。
      view.webContents.on('did-start-loading', () => {
        if (!entry.ready) return;
        entry.ready = false;
        this.resizeWindow(windowId);
      });
      view.webContents.on('dom-ready', () => {
        if (entry.ready) return;
        entry.ready = true;
        this.resizeWindow(windowId);
      });
    }
    if (input.url) void view.webContents.loadURL(input.url);
    return record;
  }

  activeContentWebContents(): WebContents | null {
    for (const entry of this.views.values()) {
      if (
        (entry.record.type === 'page' || entry.record.type === 'web') &&
        entry.record.active &&
        !entry.view.webContents.isDestroyed()
      ) {
        return entry.view.webContents;
      }
    }
    const id = this.activeWindow();
    const window = id ? this.windows.get(id) : null;
    return window && !window.window.isDestroyed()
      ? window.window.webContents
      : null;
  }

  showCapture(windowId: string, cursor: string): void {
    const entry = [...this.views.values()].find(
      (item) =>
        item.record.type === 'capture' &&
        item.window === this.windows.get(windowId)?.window,
    );
    if (!entry || entry.view.webContents.isDestroyed()) return;
    entry.view.setVisible(true);
    this.raiseSystemViews(entry.window);
    entry.view.webContents.focus();
    entry.view.webContents.send('workstudio:capture', {
      type: 'cursor',
      cursor,
    });
  }

  hideCapture(windowId: string): void {
    const window = this.windows.get(windowId)?.window;
    if (!window) return;
    for (const entry of this.views.values()) {
      if (entry.record.type === 'capture' && entry.window === window) {
        entry.view.setVisible(false);
      }
    }
    if (!window.isDestroyed()) window.webContents.focus();
  }

  /** 诊断：窗口原生视图从底到顶的顺序。 */
  viewOrder(windowId: string): Array<{ id: string; type: ViewType }> {
    const window = this.windows.get(windowId)?.window;
    if (!window || window.isDestroyed()) return [];
    const byView = new Map<unknown, ViewEntry>(
      [...this.views.values()].map((entry) => [entry.view, entry]),
    );
    return window.contentView.children.flatMap((view) => {
      const entry = byView.get(view);
      return entry ? [{ id: entry.record.id, type: entry.record.type }] : [];
    });
  }

  setSystemViewVisible(type: 'assistant' | 'overlay', visible: boolean): void {
    for (const entry of this.views.values()) {
      if (entry.record.type !== type) continue;
      if (!entry.view.webContents.isDestroyed()) entry.view.setVisible(visible);
      this.raiseSystemViews(entry.window);
    }
  }

  /** 单个窗口的系统视图显隐（对话框是窗口模态）。 */
  setWindowSystemViewVisible(
    windowId: string,
    type: 'assistant' | 'overlay',
    visible: boolean,
  ): void {
    for (const entry of this.views.values()) {
      if (entry.windowId !== windowId || entry.record.type !== type) continue;
      if (!entry.view.webContents.isDestroyed()) entry.view.setVisible(visible);
      this.raiseSystemViews(entry.window);
    }
  }

  activateView(windowId: string, id: string): void {
    const entry = this.viewOf(windowId, id);
    if (!entry) return;
    for (const [key, other] of this.views) {
      if (other.windowId !== windowId) continue;
      if (other.record.type !== 'page' && other.record.type !== 'web') {
        continue;
      }
      const active = key === ShellHost.viewKey(windowId, id);
      other.record.active = active;
      other.view.setVisible(active && other.ready);
    }
    entry.window.contentView.addChildView(entry.view);
    this.resizeWindow(windowId);
    entry.view.webContents.focus();
  }

  closeView(windowId: string, id: string): void {
    const key = ShellHost.viewKey(windowId, id);
    const entry = this.views.get(key);
    if (!entry) return;
    // 先从映射移除，避免关闭事件异步到达时覆盖紧随其后的同 id 新视图。
    this.views.delete(key);
    this.options.origins.remove(entry.senderId);
    entry.window.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
  }

  /** 平台当前生效的亮 / 暗：跟随系统时由系统决定，否则等于 themeSource。 */
  effectiveTheme(): 'light' | 'dark' {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  /** 系统主题变化：订阅方自行判断是否处于跟随系统。 */
  onSystemThemeChanged(
    listener: (theme: 'light' | 'dark') => void,
  ): () => void {
    const handler = (): void => listener(this.effectiveTheme());
    nativeTheme.on('updated', handler);
    return () => {
      nativeTheme.removeListener('updated', handler);
    };
  }

  /** 主题与内容缩放应用到所有窗口/视图。 */
  applyAppearance(
    theme: 'light' | 'dark',
    zoom: number,
    source?: 'light' | 'dark' | 'system',
  ): void {
    nativeTheme.themeSource = source ?? theme;
    const effective = this.effectiveTheme();
    const background = effective === 'dark' ? '#1a1c1d' : '#f4f4f5';
    for (const entry of this.windows.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.setBackgroundColor(background);
        if (process.platform !== 'darwin') {
          try {
            entry.window.setTitleBarOverlay({
              ...(effective === 'light'
                ? TITLEBAR_OVERLAY_COLORS.light
                : TITLEBAR_OVERLAY_COLORS.dark),
              height: TITLEBAR_HEIGHT,
            });
          } catch {
            /* 平台不支持 */
          }
        }
      }
    }
    for (const entry of this.views.values()) {
      if (entry.view.webContents.isDestroyed()) continue;
      entry.view.webContents.setZoomFactor(zoom);
      if (entry.record.type !== 'overlay' && entry.record.type !== 'capture') {
        entry.view.setBackgroundColor(background);
      }
    }
  }

  private backgroundColor(): string {
    return this.effectiveTheme() === 'dark' ? '#1a1c1d' : '#f4f4f5';
  }

  /** 应用布局快照到当前窗口的原生视图。 */
  applyLayout(windowId: string, layout: LayoutSnapshot): void {
    this.layouts.set(windowId, layout);
    this.resizeWindow(windowId);
  }

  /** 等首屏加载结束（不触发导航）：采集在 open 之后用它等页面。 */
  waitForLoad(
    windowId: string,
    id: string,
    url: string,
    timeoutMs = 8000,
  ): Promise<boolean> {
    const entry = this.viewOf(windowId, id);
    if (!entry) return Promise.resolve(false);
    const contents = entry.view.webContents;
    const target = (() => {
      try {
        const value = new URL(url);
        value.hash = '';
        return value.toString();
      } catch {
        return url;
      }
    })();
    const started = Date.now();
    const poll = async (): Promise<boolean> => {
      while (Date.now() - started < timeoutMs) {
        if (contents.isDestroyed()) return false;
        const current = (contents.getURL() || '').split('#')[0] ?? '';
        if (current === target && !contents.isLoading()) return true;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return false;
    };
    return poll();
  }

  /** 等页面稳定（首屏完成 + 有标题或正文）：采集逐页走这里。 */
  async waitForSettle(windowId: string, id: string): Promise<void> {
    const settle = this.evaluateView(
      windowId,
      id,
      `(${waitForPageReady.toString()})()`,
    ).catch(() => undefined);
    // 页面中途被销毁时 executeJavaScript 的 Promise 可能永远不结算。
    await Promise.race([
      settle,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }

  navigateView(windowId: string, id: string, url: string): void {
    const entry = this.viewOf(windowId, id);
    if (!entry) return;
    entry.record.url = url;
    void entry.view.webContents.loadURL(url);
  }

  reloadView(windowId: string, id: string): void {
    this.viewOf(windowId, id)?.view.webContents.reload();
  }

  async evaluateView<T>(
    windowId: string,
    id: string,
    script: string,
  ): Promise<T> {
    const entry = this.viewOf(windowId, id);
    if (!entry) throw new Error(`视图不存在：${id}`);
    return entry.view.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  async captureView(
    windowId: string,
    id: string,
  ): Promise<{
    url: string;
    title: string;
    excerpt: string;
    html: string;
    text: string;
    markdown: string;
    icon: string;
  }> {
    // 提取脚本跑在页面里：DOM、可见文本与 Markdown 一次取回。
    return this.evaluateView(windowId, id, `(${capturePage.toString()})()`);
  }

  async screenshotView(windowId: string, id: string): Promise<Uint8Array> {
    const entry = this.viewOf(windowId, id);
    if (!entry) throw new Error(`视图不存在：${id}`);
    const image = await entry.view.webContents.capturePage();
    return new Uint8Array(image.toPNG());
  }

  setViewDirty(_windowId: string, _id: string, _dirty: boolean): void {}

  dispose(): void {
    this.layouts.clear();
    for (const entry of this.views.values()) {
      entry.view.webContents.close();
    }
    this.views.clear();
    for (const entry of this.windows.values()) entry.window.close();
    this.windows.clear();
    this.byWorkspace.clear();
  }

  private activeWindowEntry(): WindowEntry | null {
    const id = this.activeWindow();
    return id ? (this.windows.get(id) ?? null) : null;
  }

  private activateWindow(id: string): void {
    for (const [key, entry] of this.windows) {
      entry.record.active = key === id;
    }
    for (const listener of this.windowActivatedListeners) listener(id);
  }

  private forgetWindow(id: string): void {
    const entry = this.windows.get(id);
    if (!entry) return;
    this.options.origins.remove(entry.senderId);
    this.windows.delete(id);
    this.byWorkspace.delete(entry.record.workspaceId);
    this.layouts.delete(id);
    for (const [key, view] of this.views) {
      if (view.windowId === id) this.views.delete(key);
    }
    for (const listener of this.windowClosedListeners) listener(id);
  }

  private registerShellOrigin(senderId: string, workspaceId: string): void {
    this.options.origins.register(senderId, {
      type: 'view',
      viewId: `shell:${workspaceId}`,
      viewType: 'shell',
      workspaceId,
    });
  }

  private resizeWindow(windowId: string): void {
    const windowEntry = this.windows.get(windowId);
    if (!windowEntry || windowEntry.window.isDestroyed()) return;
    const [width = 0, height = 0] = windowEntry.window.getContentSize();
    const layout = this.layouts.get(windowId) ?? defaultLayout(width, height);
    for (const entry of this.views.values()) {
      if (entry.window !== windowEntry.window) continue;
      const bounds = this.boundsOf(entry, layout, windowEntry.window);
      entry.view.setBounds(bounds);
      if (entry.record.type === 'page' || entry.record.type === 'web') {
        entry.view.setVisible(
          entry.record.type === 'web'
            ? entry.record.active
            : entry.record.active && entry.ready,
        );
      } else if (entry.record.type === 'assistant') {
        entry.view.setVisible(layout.assistantVisible);
      }
    }
    // 页面激活会把 WebContentsView 移到最上层；浮动助手、对话框与捕获层
    // 必须重新抬回，否则浮在资源面板上的助手会被页面整块盖住。
    this.raiseSystemViews(windowEntry.window);
  }

  /** 系统视图固定压在页面视图之上，顺序：assistant → overlay → capture。 */
  private raiseSystemViews(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    for (const entry of this.views.values()) {
      if (entry.window !== window) continue;
      if (
        entry.record.type === 'assistant' ||
        entry.record.type === 'overlay' ||
        entry.record.type === 'capture'
      ) {
        window.contentView.addChildView(entry.view);
      }
    }
  }

  private boundsOf(
    entry: ViewEntry,
    layout: LayoutSnapshot | undefined,
    window: BrowserWindow,
  ): Rect {
    if (layout) {
      switch (entry.record.type) {
        case 'assistant':
          return layout.assistantMode === 'floating'
            ? layout.assistantFloating
            : layout.assistantDock;
        case 'overlay':
          return layout.overlay;
        case 'capture':
          return layout.overlay;
        default:
          return layout.resourceContent;
      }
    }
    const [width = 0, height = 0] = window.getContentSize();
    const fallback = defaultLayout(width, height);
    switch (entry.record.type) {
      case 'assistant':
        return fallback.assistantMode === 'floating'
          ? fallback.assistantFloating
          : fallback.assistantDock;
      case 'overlay':
        return fallback.overlay;
      case 'capture':
        return fallback.overlay;
      default:
        return fallback.resourceContent;
    }
  }

  private windowIdOf(window: BrowserWindow): string {
    for (const [id, entry] of this.windows) {
      if (entry.window === window) return id;
    }
    return '';
  }
}
