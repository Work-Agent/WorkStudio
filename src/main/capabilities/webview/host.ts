/**
 * ViewHost —— 多类型原生视图管理（views-design.md）。
 *
 * 一条记录 = 壳（WebContentsView）+ 体（页面）+ 生命周期（状态机）+ 集合语义；
 * 渲染层拿到的是 ViewEntry 投影（列表快照），命令按 id 寻址。
 *
 * 几何：由 L3 注入的 layout 快照计算，本类只应用（setBounds/setVisible/applyStack）；
 * 层级：栈序 = 激活标签 → 助手 → overlay → capture（后 addChildView 覆盖在前）。
 */
import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import { randomUUID } from 'crypto';
import type {
  DocumentMeta,
  LayoutSnapshot,
  PluginInfo,
  Rect,
  UiDialogRequest,
  ViewEntry,
  ViewState,
} from '../../../shared/types';
import type { ViewActionView } from '../../../shared/ura';
import type { RendererInfo } from '../../../shared/types';
import type {
  ViewBusMessageFromView,
  ViewBusMessageToView,
} from '../../../shared/view-bus';
import { CH_BUS, CH_UI } from '../../../shared/channels';
import type { PluginHost } from '../../plugins/host';
import type { PageSessions } from '../../ura/page-sessions';
import { uraRegistry } from '../../ura/registry';
import { settingsPage } from '../settings/registry';
import type { UiStateService } from '../../state/ui-state';
import { createLogger } from '../../log';
import {
  CAPTURE_PAGE_URL,
  pageUrl,
  pageUrlFor,
  partitionFor,
  themeBackground,
  viewWebPreferences,
} from './presets';

const log = createLogger('views');

// ─── 类型 ─────────────────────────────────────────────────

export type ViewType = 'settings' | 'extension' | 'browser';
type ViewRole = 'tab' | 'assistant' | 'overlay' | 'capture';

export interface ViewRecord {
  id: string;
  tabKey: string;
  role: ViewRole;
  type: ViewType | 'assistant' | 'overlay' | 'capture';
  extensionId: string;
  title: string;
  url: string;
  /** 物化时真正装载的地址（资源页 = app://page/...；缺省 = url）。 */
  loadUrl?: string;
  state: ViewState;
  pinned: boolean;
  dirty: boolean;
  temporary: boolean;
  interactiveElements: boolean;
  /** 资源标签的资源元数据（侧栏展开项 / 激活项投影）。 */
  document?: DocumentMeta | null;
  /** 激活视图的渲染器（地址栏图标 / 动作作用域）。 */
  renderer?: RendererInfo;
  plugin: PluginInfo | null;
  /** 声明式标题栏动作 id（manifest extensions[].titlebarActions）。 */
  titlebarActions?: string[];
  /** 声明式动作状态（视图页 actionState 上报；如 layout-switch = preview/split/source）。 */
  actionStates?: Record<string, string>;
  layoutState?: string;
  view: WebContentsView | null;
  needsReload: boolean;
  /** URA 页面会话 id（资源页；关闭即释放）。 */
  pageSessionId?: string;
}

export type OpenViewInput =
  | { type: 'settings'; pageId: string }
  | { type: 'plugin'; pluginId: string; settings?: boolean }
  | { type: 'browser'; url: string; temporary?: boolean };

export interface ViewHostDeps {
  getWindow: () => BrowserWindow | null;
  plugins: PluginHost;
  pageSessions: PageSessions;
  uiState: UiStateService;
  workspaceId: () => string;
  /** 当前布局快照（L3 由 UiState + 浮动几何 + 预览计算）。 */
  getLayout: () => LayoutSnapshot;
  /** Shell 快照变更（布局 / 主题 / 助手形态）。 */
  broadcastState: () => void;
  /** 视图集合快照变更（ws:view）。 */
  broadcastView: () => void;
  /** 视图 → 工作台渲染层的总线转发。 */
  broadcastBus: (viewId: string, message: ViewBusMessageFromView) => void;
  /** 外部链接（window.open 的 mailto/tel、OAuth 等）。 */
  openExternal: (url: string) => void;
  /** 助手视图形态变化（供渲染层 chrome 切换）。 */
  onAssistantMode?: (floating: boolean, visible: boolean) => void;
  /** 确保该 partition 的 session 已注册 app:// 协议（协议按 session 隔离）。 */
  ensureAppProtocol: (partition: string) => void;
}

const ASSISTANT_ID = 'sys:assistant';
const OVERLAY_ID = 'sys:overlay';
const CAPTURE_ID = 'sys:capture';

// ─── ViewHost ─────────────────────────────────────────────

export class ViewHost {
  private win: BrowserWindow | null = null;
  private readonly records = new Map<string, ViewRecord>();
  /** 打开集合原始顺序（tabKey[]；顺序即数组顺序）。 */
  private order: string[] = [];
  private activeKey: string | null = null;
  private overlayPending = new Set<string>();
  private overlayVisible = false;
  private captureActive = false;
  private lastAssistantMode: { floating: boolean; visible: boolean } | null =
    null;
  readonly overlayRequests: string[] = [];

  constructor(private readonly deps: ViewHostDeps) {
    this.registerBusIpc();
    this.registerReloadShortcut();
  }

  attach(win: BrowserWindow): void {
    this.win = win;
    win.on('closed', () => {
      this.win = null;
    });
  }

  // ─── 启动 / 恢复 ────────────────────────────────────────

  /** 恢复集合记录（全部 dormant）+ 建系统视图（助手 / overlay 懒建）。 */
  restore(): void {
    const { openTabs } = this.deps.uiState.get();
    const order = openTabs?.order ?? [];
    const pinned = new Set(openTabs?.pinned ?? []);
    for (const key of order) {
      const record = this.createDormantRecord(key, pinned.has(key));
      if (!record) continue;
      this.records.set(record.id, record);
      this.order.push(key);
    }
    this.activeKey = openTabs?.activeKey ?? null;
    if (this.activeKey && !this.keyToId(this.activeKey)) {
      this.activeKey = null;
    }
    // 恢复的激活标签必须物化：否则视图停在 dormant，地址栏会一直转圈。
    const activeRecord = this.activeKey
      ? this.recordByKey(this.activeKey)
      : null;
    if (activeRecord && !activeRecord.view) {
      this.materialize(activeRecord);
      this.applyLayout();
    }
  }

  /**
   * 建 WebContentsView：先注册该 partition 的 app:// 协议（协议按 session 隔离，
   * 插件页 partition 不注册会 ERR_FAILED），再按 presets 的 webPreferences 建视图。
   */
  private createView(
    preload: import('./presets').PreloadName,
    partition: string,
  ): WebContentsView {
    this.deps.ensureAppProtocol(partition);
    return new WebContentsView({
      webPreferences: viewWebPreferences(preload, partition),
    });
  }

  /** 创建助手系统视图（启动期；页面就绪后按 UiState 呈现）。 */
  async createAssistantView(): Promise<void> {
    if (this.records.has(ASSISTANT_ID)) return;
    const view = this.createView('assistant', partitionFor('assistant'));
    try {
      view.setBackgroundColor(themeBackground(this.deps.uiState.get().theme));
    } catch {
      /* ignore */
    }
    const record: ViewRecord = {
      id: ASSISTANT_ID,
      tabKey: 'system:assistant',
      role: 'assistant',
      type: 'assistant',
      extensionId: 'assistant',
      title: 'AI 助手',
      url: 'app://assistant',
      state: 'creating',
      pinned: false,
      dirty: false,
      temporary: false,
      interactiveElements: false,
      plugin: null,
      view,
      needsReload: false,
    };
    this.records.set(ASSISTANT_ID, record);
    this.mount(record);
    this.bindCommonEvents(record);
    view.webContents.on('did-finish-load', () => {
      record.state = 'ready';
      this.sendToRecord(record, {
        type: 'theme',
        theme: this.deps.uiState.get().theme,
      });
      this.syncAssistantMode(true);
      this.broadcastViews();
    });
    await view.webContents.loadURL(pageUrl('assistant'));
    this.applyLayout();
  }

  /** 创建 overlay 浮层视图（启动期；无对话框时隐藏）。 */
  async createOverlayView(): Promise<void> {
    if (this.records.has(OVERLAY_ID)) return;
    const view = this.createView('overlay', partitionFor('overlay'));
    try {
      view.setBackgroundColor('#00000000');
    } catch {
      /* ignore */
    }
    const record: ViewRecord = {
      id: OVERLAY_ID,
      tabKey: 'system:overlay',
      role: 'overlay',
      type: 'overlay',
      extensionId: 'overlay',
      title: 'Overlay',
      url: 'app://overlay',
      state: 'creating',
      pinned: false,
      dirty: false,
      temporary: false,
      interactiveElements: false,
      plugin: null,
      view,
      needsReload: false,
    };
    this.records.set(OVERLAY_ID, record);
    this.mount(record);
    this.bindCommonEvents(record);
    view.webContents.on('did-finish-load', () => {
      record.state = 'ready';
      this.broadcastViews();
    });
    await view.webContents.loadURL(pageUrl('overlay'));
    this.applyLayout();
  }

  // ─── 集合命令 ───────────────────────────────────────────

  /** 打开（同 tabKey 转激活；幂等）。 */
  open(input: OpenViewInput): { id: string } {
    const built = this.buildOpenInput(input);
    const existing = this.recordByKey(built.tabKey);
    if (existing) {
      this.activate(existing.id);
      return { id: existing.id };
    }
    const record: ViewRecord = {
      id: randomUUID(),
      tabKey: built.tabKey,
      role: 'tab',
      type: built.type,
      extensionId: built.extensionId,
      title: built.title,
      url: built.url,
      ...(built.loadUrl ? { loadUrl: built.loadUrl } : {}),
      ...(built.renderer ? { renderer: built.renderer } : {}),
      state: 'dormant',
      pinned: false,
      dirty: false,
      temporary: built.temporary ?? false,
      interactiveElements: false,
      plugin: built.plugin,
      titlebarActions: built.titlebarActions,
      actionStates: {},
      view: null,
      needsReload: false,
    };
    this.records.set(record.id, record);
    this.order.push(record.tabKey);
    this.activate(record.id);
    return { id: record.id };
  }

  /** 按资源 id 打开（页面会话 / 实时浏览器，由投影决定）。 */
  async openResource(
    ref: string,
    document?: DocumentMeta,
  ): Promise<{ id: string }> {
    const target = await this.deps.pageSessions.open(ref);
    const tabKey = `resource:${ref}`;
    const existing = this.recordByKey(tabKey);
    if (existing) {
      if (target.type === 'page') this.deps.pageSessions.close(target.info.id);
      this.activate(existing.id);
      return { id: existing.id };
    }
    if (target.type === 'browser') {
      const record: ViewRecord = {
        id: randomUUID(),
        tabKey,
        role: 'tab',
        type: 'browser',
        extensionId: 'browser',
        title: document?.title ?? (ref.slice(ref.lastIndexOf('/') + 1) || ref),
        url: ref,
        loadUrl: target.url,
        state: 'dormant',
        pinned: false,
        dirty: false,
        temporary: false,
        interactiveElements: false,
        ...(document ? { document } : {}),
        renderer: { id: 'browser', label: '浏览器', icon: 'globe' },
        plugin: null,
        titlebarActions: [],
        actionStates: {},
        view: null,
        needsReload: false,
      };
      this.records.set(record.id, record);
      this.order.push(record.tabKey);
      this.activate(record.id);
      return { id: record.id };
    }

    const info = target.info;
    if (!info.page) {
      this.deps.pageSessions.close(info.id);
      const mime = (info.data as { mime?: string } | undefined)?.mime;
      throw new Error(
        info.surface === 'raw'
          ? `该格式没有可用的查看器：${ref}${mime ? `（${mime}）` : ''}，安装对应插件后可打开`
          : `资源没有页面入口：${ref}`,
      );
    }
    const record: ViewRecord = {
      id: randomUUID(),
      tabKey,
      role: 'tab',
      type: 'extension',
      extensionId: `ura:${info.surface}`,
      title: document?.title ?? (ref.slice(ref.lastIndexOf('/') + 1) || ref),
      url: ref,
      loadUrl: `${pageUrlFor(info.page)}?session=${info.id}`,
      state: 'dormant',
      pinned: false,
      dirty: false,
      temporary: false,
      interactiveElements: false,
      ...(document ? { document } : {}),
      renderer: {
        id: info.surface,
        ...(info.owner
          ? {
              owner: info.owner,
              ...(this.deps.plugins.get(info.owner)?.icon
                ? { icon: this.deps.plugins.get(info.owner)!.icon }
                : {}),
              ...(this.deps.plugins.get(info.owner)?.label
                ? { label: this.deps.plugins.get(info.owner)!.label }
                : {}),
              ...(this.deps.plugins.get(info.owner)?.iconUrl
                ? { iconUrl: this.deps.plugins.get(info.owner)!.iconUrl }
                : {}),
            }
          : {}),
        ...(info.codec ? { codec: info.codec } : {}),
      },
      plugin: null,
      titlebarActions: [],
      actionStates: {},
      view: null,
      needsReload: false,
      pageSessionId: info.id,
    };
    this.records.set(record.id, record);
    this.order.push(record.tabKey);
    this.activate(record.id);
    return { id: record.id };
  }

  activate(id: string): void {
    const record = this.records.get(id);
    if (!record || record.role !== 'tab') return;
    if (!record.view) this.materialize(record);
    this.activeKey = record.tabKey;
    this.persistCollection();
    this.applyLayout();
    this.focusRecord(record);
    this.broadcastViews();
  }

  close(id: string): void {
    const record = this.records.get(id);
    if (!record || record.role !== 'tab') return;
    const wasActive = this.activeKey === record.tabKey;
    this.destroyView(record);
    this.records.delete(id);
    this.order = this.order.filter((k) => k !== record.tabKey);
    if (wasActive) {
      const next = this.neighborOf(record.tabKey);
      this.activeKey = next;
      if (next) {
        const nextRecord = this.recordByKey(next);
        if (nextRecord && !nextRecord.view) this.materialize(nextRecord);
      }
    }
    this.persistCollection();
    this.applyLayout();
    this.broadcastViews();
  }

  closeOthers(anchorId: string): void {
    const anchor = this.records.get(anchorId);
    if (!anchor) return;
    for (const entry of this.entries()) {
      if (entry.tabKey === anchor.tabKey || entry.pinned) continue;
      this.close(entry.id);
    }
  }

  closeToLeft(anchorId: string): void {
    const list = this.entries();
    const idx = list.findIndex((e) => e.id === anchorId);
    if (idx < 0) return;
    for (const entry of list.slice(0, idx)) {
      if (!entry.pinned) this.close(entry.id);
    }
  }

  closeToRight(anchorId: string): void {
    const list = this.entries();
    const idx = list.findIndex((e) => e.id === anchorId);
    if (idx < 0) return;
    for (const entry of list.slice(idx + 1)) {
      if (!entry.pinned) this.close(entry.id);
    }
  }

  closeAll(): void {
    for (const entry of this.entries()) {
      if (!entry.pinned) this.close(entry.id);
    }
  }

  togglePin(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.pinned = !record.pinned;
    this.persistCollection();
    this.broadcastViews();
  }

  move(fromId: string, toId: string): void {
    const from = this.records.get(fromId);
    const to = this.records.get(toId);
    if (!from || !to || from.pinned !== to.pinned) return;
    const order = this.order.filter((k) => k !== from.tabKey);
    const idx = order.indexOf(to.tabKey);
    order.splice(idx < 0 ? order.length : idx, 0, from.tabKey);
    this.order = order;
    this.persistCollection();
    this.broadcastViews();
  }

  reload(id: string): void {
    const record = this.records.get(id);
    if (!record?.view) return;
    // 重载去重：加载中忽略（防连按打断导航）。
    if (record.state === 'loading' || record.state === 'reloading') return;
    record.state = 'reloading';

    this.sendToRecord(record, {
      type: 'theme',
      theme: this.deps.uiState.get().theme,
    });
    record.view.webContents.reload();
    this.broadcastViews();
  }

  navigate(id: string, url: string): void {
    const record = this.records.get(id);
    if (record?.type !== 'browser' || !record.view) return;
    record.url = url;
    void record.view.webContents
      .loadURL(url)
      .catch((e) => log.error('navigate failed', e));
  }

  goBack(id: string): void {
    const wc = this.records.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.records.get(id)?.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  setInteractiveElements(id: string, on: boolean): boolean {
    const record = this.records.get(id);
    if (!record || record.type !== 'browser') return false;
    record.interactiveElements = on;
    this.broadcastViews();
    return on;
  }

  /** 运行插件注册的地址栏动作（toggle 动作维护每视图状态）。 */
  runAction(id: string, actionId: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    const entry = uraRegistry.viewAction(actionId);
    if (!entry) return false;
    const action = entry.action;
    const current = record.actionStates?.[actionId];
    const on = action.toggle ? current !== 'on' : true;
    const setState = (state: string): void => {
      record.actionStates = {
        ...(record.actionStates ?? {}),
        [actionId]: state,
      };
      this.broadcastViews();
    };
    const execute = async <T>(script: string): Promise<T> => {
      const wc = record.view?.webContents;
      if (!wc) throw new Error('视图尚未就绪');
      return (await wc.executeJavaScript(script)) as T;
    };
    if (action.toggle) setState(on ? 'on' : 'off');
    void Promise.resolve(
      action.run({
        viewId: id,
        type: record.type === 'browser' ? 'browser' : 'extension',
        on,
        setState,
        execute,
      }),
    ).catch((error) => log.warn('view action failed', error));
    return true;
  }

  /** 声明式标题栏动作 → 视图（页面以 actionState 回报当前状态）。 */
  sendAction(id: string, action: string, payload?: unknown): void {
    const record = this.records.get(id);
    if (!record || record.role !== 'tab') return;
    this.sendToRecord(record, {
      type: 'action',
      id: action,
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  // ─── 查询（渲染层投影） ─────────────────────────────────

  /** 集合投影（固定项在前；两组内部保持打开顺序）。 */
  list(): ViewEntry[] {
    return this.entries().map((r) => this.toEntry(r));
  }

  getActiveId(): string | null {
    const key = this.activeKey;
    return key ? this.keyToId(key) : null;
  }

  getWebContents(id: string): Electron.WebContents | undefined {
    const wc = this.records.get(id)?.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : undefined;
  }

  /** raw 浏览器视图（按打开顺序；用于自动化选活跃面板）。 */
  listBrowser(): Array<{
    id: string;
    url: string;
    title: string;
    active: boolean;
  }> {
    return this.entries()
      .filter((r) => r.type === 'browser')
      .map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        active: this.activeKey === r.tabKey,
      }));
  }

  waitForLoad(id: string, timeoutMs = 15000): Promise<void> {
    const record = this.records.get(id);
    if (!record?.view) return Promise.resolve();
    if (record.state === 'ready' || record.state === 'contentDelivered')
      return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), timeoutMs);
      const wc = record.view?.webContents;
      if (!wc) {
        clearTimeout(timer);
        resolve();
        return;
      }
      wc.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ─── 扩展 UI（overlay） ─────────────────────────────────

  /** 对话框请求：显示 overlay 并转发（pending 计数归主进程）。 */
  showDialog(req: UiDialogRequest): void {
    this.overlayPending.add(req.id);
    this.sendToId(OVERLAY_ID, req as never);
    this.setOverlayVisible(true);
  }

  resolveDialog(id: string): void {
    this.overlayPending.delete(id);
    this.sendToId(OVERLAY_ID, { type: 'dialogResolved', id } as never);
    if (this.overlayPending.size === 0) this.setOverlayVisible(false);
  }

  /**
   * 全局快照广播到系统视图（助手 / overlay）。
   * BrowserWindow 广播只覆盖窗口自身 webContents；系统视图是独立
   * WebContentsView，必须单独投递（ws:state / ws:event）。
   */
  broadcastToSystemViews(channel: string, payload: unknown): void {
    for (const id of [ASSISTANT_ID, OVERLAY_ID]) {
      const wc = this.records.get(id)?.view?.webContents;
      console.log(
        '[views] sys-broadcast',
        channel,
        id,
        Boolean(wc),
        wc ? wc.isDestroyed() : 'n/a',
      );
      if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    }
  }

  /** 非阻塞通知 / 其它 ws:ui 消息 → 工作台渲染层。 */
  sendUiToWorkbench(payload: unknown): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(CH_UI, payload);
  }

  // ─── 系统视图 / 布局 ────────────────────────────────────

  /** 应用布局：全部原生视图 bounds + 可见性 + 层级。 */
  applyLayout(): void {
    const layout = this.deps.getLayout();
    const ui = this.deps.uiState.get();
    const activeKey = this.activeKey;

    for (const record of this.records.values()) {
      if (record.role !== 'tab' || !record.view) continue;
      if (record.tabKey === activeKey) {
        this.setBounds(record, layout.resourceContent);
        record.view.setVisible(true);
      } else {
        record.view.setVisible(false);
      }
    }

    const assistant = this.records.get(ASSISTANT_ID);
    if (assistant?.view) {
      const visible = ui.aiOpen;
      if (visible) {
        this.setBounds(
          assistant,
          ui.aiFloating ? layout.assistantFloating : layout.assistantDock,
        );
        // 浮动态：原生圆角 cutout + 透明底（圆角外露出下层内容，而非视图底色）。
        try {
          assistant.view.setBorderRadius(ui.aiFloating ? 12 : 0);
          assistant.view.setBackgroundColor(
            ui.aiFloating ? '#00000000' : themeBackground(ui.theme),
          );
        } catch {
          /* 平台不支持时忽略（页面自身圆角兜底） */
        }
      }
      assistant.view.setVisible(visible);
      this.syncAssistantMode(visible);
    }

    const overlay = this.records.get(OVERLAY_ID);
    if (overlay?.view) {
      this.setBounds(overlay, layout.overlay);
      overlay.view.setVisible(this.overlayVisible);
    }

    const capture = this.records.get(CAPTURE_ID);
    if (capture?.view && this.captureActive) {
      this.setBounds(capture, layout.workbench);
      // 捕获层是交互期唯一输入层：必须可见（可见才参与命中测试）。
      capture.view.setVisible(true);
    }

    this.applyStack();
  }

  /** 主题变更：原生视图底色 + 主题广播。 */
  onThemeChanged(theme: 'light' | 'dark'): void {
    const assistantFloating = this.deps.uiState.get().aiFloating;
    for (const record of this.records.values()) {
      if (!record.view) continue;
      if (record.type === 'browser' || record.type === 'assistant') {
        try {
          // 浮动态助手保持透明（原生圆角外的下层内容要透出来）。
          const transparent = record.type === 'assistant' && assistantFloating;
          record.view.setBackgroundColor(
            transparent ? '#00000000' : themeBackground(theme),
          );
        } catch {
          /* ignore */
        }
      }
      this.sendToRecord(record, { type: 'theme', theme });
    }
  }

  /**
   * 指针捕获层：透明全工作台视图，接收全部指针事件。
   *
   * 常驻（启动期预热）：每次拖拽现建现加载会丢「快速按下-弹起」的 pointerup
   * （页面未就绪），表现为松手后仍跟随鼠标。交互期只切显隐，不重建。
   */
  warmCaptureView(): WebContentsView {
    const view = this.ensureCaptureView();
    if (view.webContents.getURL() === '') {
      void view.webContents.loadURL(CAPTURE_PAGE_URL).catch(() => undefined);
    }
    return view;
  }

  private ensureCaptureView(): WebContentsView {
    const existing = this.records.get(CAPTURE_ID);
    if (existing?.view) return existing.view;
    const view = new WebContentsView({
      webPreferences: viewWebPreferences(
        'capture',
        'in-memory:workstudio:capture',
      ),
    });
    try {
      view.setBackgroundColor('#00000000');
    } catch {
      /* ignore */
    }
    const record: ViewRecord = {
      id: CAPTURE_ID,
      tabKey: 'system:capture',
      role: 'capture',
      type: 'capture',
      extensionId: 'capture',
      title: 'Capture',
      url: 'app://capture',
      state: 'loading',
      pinned: false,
      dirty: false,
      temporary: false,
      interactiveElements: false,
      plugin: null,
      view,
      needsReload: false,
    };
    this.records.set(CAPTURE_ID, record);
    this.mount(record);
    return view;
  }

  /** 交互期显隐（常驻视图；隐藏时不参与命中测试）。 */
  setCaptureActive(active: boolean): void {
    this.captureActive = active;
    const record = this.records.get(CAPTURE_ID);
    if (!record?.view) return;
    if (active) {
      this.applyLayout();
      this.applyStack();
    } else {
      try {
        record.view.setVisible(false);
        record.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    for (const record of this.records.values()) this.destroyView(record);
    this.records.clear();
  }

  // ─── 内部：记录构造 ─────────────────────────────────────

  private buildOpenInput(input: OpenViewInput): {
    tabKey: string;
    type: ViewType;
    extensionId: string;
    title: string;
    url: string;
    loadUrl?: string;
    renderer?: RendererInfo;
    plugin: PluginInfo | null;
    titlebarActions: string[];
    temporary?: boolean;
  } {
    if (input.type === 'settings') {
      // 插件设置页与内置页同属设置面：settings://plugin.<id> 转交插件页面。
      if (input.pageId.startsWith('plugin.')) {
        return this.buildOpenInput({
          type: 'plugin',
          pluginId: input.pageId.slice('plugin.'.length),
          settings: true,
        });
      }
      const page = settingsPage(input.pageId);
      if (!page) throw new Error(`Settings page not found: ${input.pageId}`);
      return {
        tabKey: `settings:${page.id}`,
        type: 'settings',
        extensionId: `settings:${page.id}`,
        title: page.label,
        url: `settings://${page.id}`,
        loadUrl: pageUrlFor(page.page),
        renderer: {
          id: `settings:${page.id}`,
          label: page.label,
          icon: page.icon,
        },
        plugin: null,
        titlebarActions: [],
      };
    }
    if (input.type === 'plugin') {
      const pkg = this.deps.plugins.getPage(input.pluginId);
      if (!pkg) throw new Error(`Plugin not found: ${input.pluginId}`);
      // 设置入口只给真有 settings 页的插件；没有就报错，不退化成打开资源页。
      if (input.settings && !pkg.settings) {
        throw new Error(`插件没有设置页：${pkg.id}`);
      }
      const page =
        (input.settings ? pkg.settings : (pkg.page ?? pkg.settings)) ?? null;
      if (!page) throw new Error(`Plugin page not found: ${input.pluginId}`);
      // 插件设置页归设置面：ref 用 settings: scheme，标签键与内置设置页同构。
      return {
        tabKey: input.settings
          ? `settings:plugin.${pkg.id}`
          : `plugin:${pkg.id}`,
        type: 'extension',
        extensionId: `plugin:${pkg.id}`,
        title: input.settings ? `${pkg.label} 设置` : pkg.label,
        url: input.settings
          ? `settings://plugin.${pkg.id}`
          : `plugin://${pkg.id}`,
        loadUrl: pageUrlFor(page),
        renderer: {
          id: pkg.id,
          label: pkg.label,
          ...(pkg.icon ? { icon: pkg.icon } : {}),
          ...(pkg.iconUrl ? { iconUrl: pkg.iconUrl } : {}),
          owner: pkg.id,
        },
        plugin: {
          id: pkg.id,
          name: pkg.label,
          version: pkg.version,
          builtin: true,
          extensionCount: 1,
          skillCount: 0,
          toolCount: 0,
          hasHome: false,
          hasConfig: !!pkg.settings,
        },
        titlebarActions: [],
      };
    }
    return {
      tabKey: `browser:${input.url}`,
      type: 'browser',
      extensionId: 'browser',
      title: this.titleForUrl(input.url),
      url: input.url,
      plugin: null,
      titlebarActions: [],
      ...(input.temporary ? { temporary: true } : {}),
    };
  }

  /** 恢复：按 tabKey 重建 dormant 记录（失效键丢弃）。 */
  private createDormantRecord(
    tabKey: string,
    pinned: boolean,
  ): ViewRecord | null {
    const [prefix, ...rest] = tabKey.split(':');
    try {
      let built: ReturnType<ViewHost['buildOpenInput']>;
      if (prefix === 'settings') {
        const pageId = rest.join(':');
        built = pageId.startsWith('plugin.')
          ? this.buildOpenInput({
              type: 'plugin',
              pluginId: pageId.slice('plugin.'.length),
              settings: true,
            })
          : this.buildOpenInput({ type: 'settings', pageId });
      } else if (prefix === 'plugin') {
        const pluginId = rest[0] ?? '';
        const settings = rest.slice(1).join(':') === 'settings';
        built = this.buildOpenInput({ type: 'plugin', pluginId, settings });
      } else if (prefix === 'browser') {
        built = this.buildOpenInput({ type: 'browser', url: rest.join(':') });
      } else {
        return null;
      }
      return {
        id: randomUUID(),
        tabKey,
        role: 'tab',
        type: built.type,
        extensionId: built.extensionId,
        title: built.title,
        url: built.url,
        ...(built.loadUrl ? { loadUrl: built.loadUrl } : {}),
        ...(built.renderer ? { renderer: built.renderer } : {}),
        state: 'dormant',
        pinned,
        dirty: false,
        temporary: false,
        interactiveElements: false,
        plugin: built.plugin,
        titlebarActions: built.titlebarActions,
        actionStates: {},
        view: null,
        needsReload: false,
      };
    } catch {
      return null;
    }
  }

  // ─── 内部：物化与事件 ───────────────────────────────────

  private materialize(record: ViewRecord): void {
    if (record.view) return;
    if (record.type === 'extension' || record.type === 'settings') {
      const loadUrl = record.loadUrl;
      if (!loadUrl) {
        record.state = 'error';
        this.broadcastViews();
        return;
      }
      const partition =
        record.type === 'settings'
          ? partitionFor('plugin', 'settings')
          : partitionFor(
              'plugin',
              record.pageSessionId ? 'ura' : (record.plugin?.id ?? 'plugin'),
            );
      const view = this.createView('extension', partition);
      record.view = view;
      this.mount(record);
      this.bindCommonEvents(record);
      this.bindBrowserLikeEvents(record, false);
      this.wrapWindowOpen(record);
      record.state = 'loading';
      void view.webContents
        .loadURL(loadUrl)
        .catch((e) => log.error('extension load failed', e));
      return;
    }
    if (record.type === 'browser') {
      const view = this.createView('browser', partitionFor('browser'));
      try {
        view.setBackgroundColor(themeBackground(this.deps.uiState.get().theme));
      } catch {
        /* ignore */
      }
      record.view = view;
      this.mount(record);
      this.bindCommonEvents(record);
      this.bindBrowserLikeEvents(record, true);
      this.wrapWindowOpen(record);
      record.state = 'loading';
      void view.webContents
        .loadURL(record.url)
        .catch((e) => log.error('browser load failed', e));
    }
  }

  private mount(record: ViewRecord): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !record.view) return;
    win.contentView.addChildView(record.view);
    record.view.setVisible(false);
  }

  private destroyView(record: ViewRecord): void {
    if (record.pageSessionId) {
      this.deps.pageSessions.close(record.pageSessionId);
      record.pageSessionId = undefined;
    }
    const win = this.win;
    if (record.view) {
      try {
        if (win && !win.isDestroyed())
          win.contentView.removeChildView(record.view);
      } catch {
        /* 窗口已销毁 */
      }
      try {
        const wc = record.view.webContents as unknown as {
          destroy?: () => void;
        };
        wc.destroy?.();
      } catch {
        /* ignore */
      }
      record.view = null;
    }
    record.state = 'destroyed';
  }

  /** 公共事件：加载失败 / 进程崩溃（纪律：过滤 -3、memory-eviction 不动状态）。 */
  private bindCommonEvents(record: ViewRecord): void {
    const view = record.view;
    if (!view) return;
    const wc = view.webContents;
    wc.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame) return;
      if (record.state === 'loading' || record.state === 'reloading') return;
      record.state = 'loading';
      this.broadcastViews();
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (code === -3 || !isMainFrame) return;
      log.warn('load failed', record.url, code, desc, url);
      record.state = 'error';
      this.broadcastViews();
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      if (details.reason === 'memory-eviction') {
        record.needsReload = true;
        return;
      }
      record.state = 'error';
      record.needsReload = true;
      this.broadcastViews();
    });
    wc.on('destroyed', () => {
      if (record.role === 'tab' && this.records.has(record.id)) {
        this.close(record.id);
      }
    });
  }

  /** 浏览器类事件：就绪 = did-finish-load；导航 / 标题变化同步记录。 */
  private bindBrowserLikeEvents(record: ViewRecord, isBrowser: boolean): void {
    const view = record.view;
    if (!view) return;
    const wc = view.webContents;
    wc.on('did-finish-load', () => {
      record.state = 'ready';
      if (isBrowser) {
        record.url = wc.getURL() || record.url;
        const title = wc.getTitle();
        if (title && title !== record.url) record.title = title;
      }
      this.broadcastViews();
    });
    if (isBrowser) {
      const onNav = (): void => {
        record.url = wc.getURL() || record.url;
        const title = wc.getTitle();
        if (title && title !== record.url) record.title = title;
        this.broadcastViews();
      };
      wc.on('did-navigate', onNav);
      wc.on('did-navigate-in-page', onNav);
      wc.on('page-title-updated', onNav);
    }
  }

  private wrapWindowOpen(record: ViewRecord): void {
    record.view?.webContents.setWindowOpenHandler(({ url }) => {
      let scheme = '';
      try {
        scheme = new URL(url).protocol;
      } catch {
        /* 非法 URL */
      }
      if (scheme === 'http:' || scheme === 'https:') {
        try {
          this.open({ type: 'browser', url });
        } catch (e) {
          log.warn('open tab failed', e);
        }
      } else if (scheme === 'mailto:' || scheme === 'tel:') {
        this.deps.openExternal(url);
      }
      return { action: 'deny' };
    });
  }

  /** 就绪握手（扩展页 loaded / 刷新兜底）。 */
  private markReady(record: ViewRecord): void {
    if (record.state === 'ready' || record.state === 'contentDelivered') return;
    record.state = 'ready';
    this.broadcastViews();
  }

  // ─── 内部：总线 / IPC ───────────────────────────────────

  private registerBusIpc(): void {
    ipcMain.on(
      CH_BUS,
      (event, message: ViewBusMessageFromView & { viewId?: string }) => {
        const record = this.recordByWebContentsId(event.sender.id);
        if (!record) return;
        switch (message.type) {
          case 'loaded':
            this.markReady(record);
            break;
          case 'dirty':
            record.dirty = message.dirty === true;
            this.broadcastViews();
            break;
          case 'actionState':
            record.actionStates = {
              ...record.actionStates,
              [String(message.id ?? '')]: String(message.value ?? ''),
            };
            this.broadcastViews();
            break;
          case 'navigate':
            if (record.type === 'browser')
              this.navigate(record.id, message.url);
            break;
          case 'refClick':
          case 'log':
            this.deps.broadcastBus(record.id, message);
            break;
        }
      },
    );
  }

  /** Cmd/Ctrl+R / F5 → 当前激活视图重载（不重载工作台渲染层）。 */
  private registerReloadShortcut(): void {
    app.on('web-contents-created', (_e, wc) => {
      wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isReload =
          (input.key === 'r' && (input.meta || input.control)) ||
          input.key === 'F5';
        if (!isReload) return;
        const record = this.recordByWebContentsId(wc.id);
        if (record && record.role === 'tab') {
          event.preventDefault();
          this.reload(record.id);
          return;
        }
        if (wc === this.win?.webContents) {
          event.preventDefault();
          const activeId = this.getActiveId();
          if (activeId) this.reload(activeId);
        }
      });
    });
  }

  private sendToRecord(
    record: ViewRecord,
    message: ViewBusMessageToView,
  ): void {
    const wc = record.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(CH_BUS, message);
  }

  private sendToId(id: string, payload: unknown): void {
    const wc = this.records.get(id)?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(CH_UI, payload);
  }

  private recordByWebContentsId(webContentsId: number): ViewRecord | null {
    for (const record of this.records.values()) {
      if (record.view?.webContents.id === webContentsId) return record;
    }
    return null;
  }

  // ─── 内部：几何 / 层级 ──────────────────────────────────

  private setBounds(record: ViewRecord, rect: Rect): void {
    if (!record.view) return;
    try {
      record.view.setBounds(rect);
    } catch {
      /* 视图已销毁 */
    }
  }

  /** 栈序：标签 → 助手 → overlay → capture（后挂在高）；组成不变时跳过重排。 */
  private lastStackKey = '';
  private applyStack(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const order: ViewRecord[] = [];
    for (const record of this.records.values()) {
      if (
        record.role === 'tab' &&
        record.view &&
        this.activeKey === record.tabKey
      )
        order.push(record);
    }
    for (const id of [ASSISTANT_ID, OVERLAY_ID, CAPTURE_ID]) {
      const record = this.records.get(id);
      if (record?.view) order.push(record);
    }
    const key = order.map((r) => r.id).join('|');
    if (key === this.lastStackKey) return;
    this.lastStackKey = key;
    for (const record of order) {
      try {
        win.contentView.addChildView(record.view!);
      } catch {
        /* ignore */
      }
    }
  }

  private focusRecord(record: ViewRecord): void {
    if (!record.view) return;
    try {
      record.view.webContents.focus();
    } catch {
      /* ignore */
    }
  }

  private syncAssistantMode(visible: boolean): void {
    const floating = this.deps.uiState.get().aiFloating;
    if (
      this.lastAssistantMode &&
      this.lastAssistantMode.floating === floating &&
      this.lastAssistantMode.visible === visible
    ) {
      return;
    }
    this.lastAssistantMode = { floating, visible };
    const record = this.records.get(ASSISTANT_ID);
    if (record) this.sendToRecord(record, { type: 'mode', floating, visible });
    this.deps.onAssistantMode?.(floating, visible);
  }

  private setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
    const overlay = this.records.get(OVERLAY_ID);
    if (overlay?.view) overlay.view.setVisible(visible);
    if (visible) this.applyStack();
  }

  // ─── 内部：集合工具 ─────────────────────────────────────

  /** 显示顺序（固定项稳定在前）。 */
  private entries(): ViewRecord[] {
    const tabs = this.order
      .map((key) => this.recordByKey(key))
      .filter((r): r is ViewRecord => r != null);
    const pinned = tabs.filter((r) => r.pinned);
    const normal = tabs.filter((r) => !r.pinned);
    return [...pinned, ...normal];
  }

  private recordByKey(tabKey: string): ViewRecord | undefined {
    for (const record of this.records.values()) {
      if (record.role === 'tab' && record.tabKey === tabKey) return record;
    }
    return undefined;
  }

  private keyToId(tabKey: string): string | null {
    return this.recordByKey(tabKey)?.id ?? null;
  }

  private neighborOf(tabKey: string): string | null {
    const list = this.entries();
    const idx = list.findIndex((r) => r.tabKey === tabKey);
    if (idx < 0) return null;
    const next = list[idx + 1] ?? list[idx - 1];
    return next?.tabKey ?? null;
  }

  private toEntry(record: ViewRecord): ViewEntry {
    return {
      id: record.id,
      tabKey: record.tabKey,
      type: record.type as ViewEntry['type'],
      extensionId: record.extensionId,
      title: record.title,
      url: record.url,
      state: record.state,
      active: this.activeKey === record.tabKey,
      pinned: record.pinned,
      dirty: record.dirty,
      ...(record.temporary ? { temporary: true } : {}),
      ...(record.interactiveElements ? { interactiveElements: true } : {}),
      ...(record.document ? { document: record.document } : {}),
      ...(record.renderer ? { renderer: record.renderer } : {}),
      ...(record.plugin ? { plugin: record.plugin } : {}),
      ...(record.titlebarActions?.length
        ? { titlebarActions: record.titlebarActions }
        : {}),
      ...(record.actionStates && Object.keys(record.actionStates).length
        ? { actionStates: record.actionStates }
        : {}),
      ...(record.actionStates?.['layout-switch']
        ? { layout: record.actionStates['layout-switch'] }
        : {}),
      ...(() => {
        const actions = this.actionsForRecord(record);
        return actions.length ? { actions } : {};
      })(),
    };
  }

  private actionsForRecord(record: ViewRecord): ViewActionView[] {
    if (record.role !== 'tab') return [];
    const renderer = record.renderer;
    return uraRegistry
      .viewActions()
      .filter(({ action }) => {
        if (action.target === 'any') return true;
        if (action.target === 'browser') return record.type === 'browser';
        if (!renderer) return false;
        return (
          action.target === renderer.id ||
          action.target === renderer.owner ||
          action.target === renderer.codec
        );
      })
      .map(({ action }) => ({
        id: action.id,
        label: action.label,
        ...(action.icon ? { icon: action.icon } : {}),
        toggle: action.toggle === true,
        active: record.actionStates?.[action.id] === 'on',
      }));
  }

  private persistCollection(): void {
    const order = this.order.filter((key) => !key.startsWith('resource:'));
    const pinned = this.entries()
      .filter((r) => r.pinned)
      .map((r) => r.tabKey);
    this.deps.uiState.set({
      openTabs: { order, pinned, activeKey: this.activeKey },
    });
  }

  private titleForUrl(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '') || url;
    } catch {
      return url;
    }
  }

  private broadcastViews(): void {
    this.deps.broadcastView();
  }
}

/** 主题色的原生兜底（nativeTheme 变化时由 L3 调 ViewHost.onThemeChanged）。 */
export function currentThemeIsDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

/** 释放窗口资源（shell.openExternal 便捷包装）。 */
export function openExternalUrl(url: string): void {
  void shell.openExternal(url);
}
