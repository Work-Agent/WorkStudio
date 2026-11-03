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
  session,
  shell,
  type App as ElectronApp,
  type MenuItemConstructorOptions,
  type Session,
  type WebContents,
} from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { LayoutSnapshot } from '../../shared/types';
import { preloadPath } from '../capabilities/webview/presets';
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
  applyLayout(layout: LayoutSnapshot): void;
  webContentsId(): number | null;
  send(channel: string, payload: unknown): void;
}

interface ViewsPort {
  create(input: NativeViewInput, hooks?: ViewHooks): number | null;
  close(viewId: string): void;
  activate(viewId: string): void;
  reload(viewId: string): void;
  navigate(viewId: string, url: string): void;
  goBack(viewId: string): void;
  goForward(viewId: string): void;
  send(viewId: string, channel: string, payload: unknown): void;
  setVisible(viewId: string, visible: boolean): void;
  webContents(viewId: string): WebContents | null;
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
      setVisible: (viewId, visible) => {
        const entry = this.viewsById.get(viewId);
        if (entry) entry.view.setVisible(visible);
      },
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
    if (
      input.type === 'page' ||
      input.type === 'web' ||
      input.type === 'overlay' ||
      input.type === 'capture'
    ) {
      view.setBackgroundColor('#00000000');
      view.setVisible(false);
    }
    this.viewsById.set(input.viewId, { view, type: input.type });
    if (hooks) this.hooksById.set(input.viewId, hooks);
    view.webContents.on('did-finish-load', () => hooks?.onReady?.());
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
        entry.view.setVisible(id === viewId);
      }
    }
    this.viewsById.get(viewId)?.view.webContents.focus();
  }

  private applyLayout(next: LayoutSnapshot): void {
    this.layout = next;
    for (const entry of this.viewsById.values()) {
      const rect =
        entry.type === 'assistant'
          ? next.assistantMode === 'floating'
            ? next.assistantFloating
            : next.assistantDock
          : entry.type === 'overlay' || entry.type === 'capture'
            ? next.overlay
            : next.resourceContent;
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      entry.view.setBounds(bounds);
    }
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
