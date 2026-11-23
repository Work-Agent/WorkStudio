/**
 * views 组件：两层视图结构 + tabs domain。
 *
 *   GlobalViews  窗口级系统视图（shell / assistant / overlay / capture）
 *   Tabs         资源面板标签（page / web）
 *   Views        app-level 查找 / 发送 / tabs 投影
 *
 * 两层共享同一套原生承载和发送逻辑，但状态与生命周期分开：
 * 系统视图不进入标签集合，标签只管理内容视图。
 */

import { WebContentsView } from 'electron';
import type { Rectangle, WebPreferences } from 'electron';
import { hardenWebContents } from '../../runtime/policy.ts';
import type {
  Domain,
  DomainRegistry,
  Resource,
} from '../../runtime/domains.ts';
import { workUrl } from '../../../shared/pages.ts';
import { ViewProviders } from './view-providers.ts';
import type { OpenTarget, ViewProvider, ViewSpec } from './view-providers.ts';
import type { WindowManager, WorkspaceWindow } from './native.ts';
import { CH_BUS } from '../../../shared/channels.ts';
import {
  CallFailure,
  IPC_CHANNELS,
  type DomainUpdate,
  type Origin,
  type ViewType,
} from '../../runtime/shared.ts';

export const UPDATE_CHANNEL = IPC_CHANNELS.update;

export type ViewState = 'loading' | 'ready' | 'crashed';

export interface ViewRecord {
  id: string;
  wsId: string;
  type: ViewType;
  title: string;
  url: string;
  contentPath: string | null;
  sessionId: string | null;
  externalId: string | null;
  state: ViewState;
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  missing: boolean;
  conflict: boolean;
  /** 复用组：同组 tab 会被替换（例如 settings / capabilities）。 */
  reuseKey: string | null;
  /** 打开它的 provider 类型；关闭时用于 release。 */
  providerType: string | null;
  /** 插件页 actionState 上报。 */
  actionStates: Record<string, string>;
}

/** tabs 投影；系统视图不进入这里。 */
export interface ViewSnapshot {
  id: string;
  wsId: string;
  tabKey: string;
  type: ViewType;
  title: string;
  url: string;
  contentPath: string | null;
  state: ViewState;
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  missing: boolean;
  conflict: boolean;
  actionStates: Record<string, string>;
}

export interface CreateViewInput {
  id?: string;
  type: ViewType;
  title?: string;
  externalId?: string | null;
  url?: string;
  contentPath?: string | null;
  sessionId?: string | null;
  reuseKey?: string | null;
  providerType?: string | null;
  partition?: string;
  preload?: string;
  bounds?: Rectangle;
  webPreferences?: WebPreferences;
}

type Sink = (channel: string, payload: unknown) => void;

/** 一个窗口的视图承载：记录、原生 view / shell sink、发送。 */
abstract class ViewHost {
  protected readonly records = new Map<string, ViewRecord>();
  protected readonly external = new Map<string, string>();
  protected readonly native = new Map<string, WebContentsView>();
  protected readonly sinks = new Map<string, Sink>();
  protected readonly wsId: string;
  private readonly bounds = new Map<string, Rectangle>();
  private counter = 0;

  constructor(protected readonly window: WorkspaceWindow) {
    this.wsId = window.wsId;
  }

  get(id: string): ViewRecord | null {
    return this.records.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  originOf(externalId: string): Origin | null {
    const id = this.external.get(externalId);
    if (!id) return null;
    const record = this.records.get(id);
    if (!record) return null;
    return {
      type: 'view',
      viewId: record.id,
      viewType: record.type,
    };
  }

  send(viewId: string, update: DomainUpdate): void {
    this.deliver(viewId, UPDATE_CHANNEL, update);
  }

  /** 原生承载的视图（shell 只有 sink，没有 WebContentsView）。 */
  nativeView(id: string): WebContentsView | null {
    return this.native.get(id) ?? null;
  }

  /** 写入并记住几何；不可见视图也先记住，显示时补写。 */
  setBounds(id: string, rect: Rectangle): void {
    this.bounds.set(id, rect);
    this.native.get(id)?.setBounds(rect);
  }

  /** 整个 host 共用一块几何（tabs 的内容区）。 */
  setUniformBounds(rect: Rectangle): void {
    for (const id of this.records.keys()) this.setBounds(id, rect);
  }

  protected createRecord(input: CreateViewInput): ViewRecord {
    const id = input.id ?? `${this.wsId}:${input.type}-${this.nextId()}`;
    if (this.records.has(id)) throw new Error(`view ${id} already exists`);

    const record: ViewRecord = {
      id,
      wsId: this.wsId,
      type: input.type,
      title: input.title ?? input.type,
      url: input.url ?? '',
      contentPath: input.contentPath ?? null,
      sessionId: input.sessionId ?? null,
      externalId: input.externalId ?? null,
      state: 'loading',
      active: false,
      pinned: false,
      dirty: false,
      missing: false,
      conflict: false,
      reuseKey: input.reuseKey ?? null,
      providerType: input.providerType ?? null,
      actionStates: {},
    };
    this.records.set(id, record);
    if (record.externalId) this.external.set(record.externalId, id);
    return record;
  }

  protected mount(record: ViewRecord, input: CreateViewInput): void {
    const owner = this.window.current();
    if (!owner) return;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        ...(input.partition ? { partition: input.partition } : {}),
        ...(input.preload ? { preload: input.preload } : {}),
        ...input.webPreferences,
      },
    });

    if (input.bounds) this.setBounds(record.id, input.bounds);
    if (
      record.type === 'page' ||
      record.type === 'web' ||
      record.type === 'overlay' ||
      record.type === 'capture'
    ) {
      view.setBackgroundColor('#00000000');
    }
    hardenWebContents(view.webContents, {
      allowHttp: record.type === 'web',
      allowApp: record.type === 'page',
    });
    if (record.type === 'web') {
      view.webContents.setWindowOpenHandler(({ url }) => {
        // 网页 target=_blank / window.open：应用内新标签，不交给系统浏览器。
        this.window.tabs.create({ type: 'web', url, title: url });
        return { action: 'deny' };
      });
    }
    owner.contentView.addChildView(view);
    this.native.set(record.id, view);
    if (record.externalId) this.external.set(record.externalId, record.id);
    const wcId = view.webContents.id;
    if (record.externalId) this.external.delete(record.externalId);
    record.externalId = String(wcId);
    this.external.set(String(wcId), record.id);

    view.webContents.on('did-finish-load', () => {
      // 首帧兜底：隐藏期设过几何的视图尤其需要补写。
      const rect = this.bounds.get(record.id);
      if (rect) view.setBounds(rect);
      this.onViewState(record.id, 'ready');
    });
    view.webContents.on('render-process-gone', () =>
      this.onViewState(record.id, 'crashed'),
    );
    view.webContents.on('page-title-updated', (_event, title) => {
      if (record.type === 'web') this.onViewTitle(record.id, title);
    });
    view.webContents.on('did-navigate', (_event, url) => {
      if (record.type === 'web') this.onViewNavigate(record.id, url);
    });
    void view.webContents.loadURL(input.url!).catch((error: unknown) => {
      console.error('[app] view load failed', input.url, error);
    });
  }

  /** 子类按需把原生状态同步到自己的投影。 */
  protected onViewState(_viewId: string, _state: ViewState): void {}
  protected onViewTitle(_viewId: string, _title: string): void {}
  protected onViewNavigate(_viewId: string, _url: string): void {}

  protected setVisible(id: string, visible: boolean): void {
    const view = this.native.get(id);
    if (!view) return;
    view.setVisible(visible);
    // Windows 上「隐藏期间设过 bounds → 再 show」不会重建合成面，补写一次几何。
    if (visible) {
      const rect = this.bounds.get(id);
      if (rect) view.setBounds(rect);
    }
  }

  protected focus(id: string): void {
    this.native.get(id)?.webContents.focus();
  }

  /** 删除记录和原生承载；通知由子类决定（tabs 需要先算下一个激活项）。 */
  remove(id: string): ViewRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    if (record.externalId) this.external.delete(record.externalId);
    this.closeNative(id);
    this.sinks.delete(id);
    this.records.delete(id);
    return record;
  }

  private nextId(): number {
    this.counter += 1;
    return this.counter;
  }

  private closeNative(id: string): void {
    const view = this.native.get(id);
    if (!view) return;
    try {
      this.window.current()?.contentView.removeChildView(view);
      view.webContents.close();
    } catch {
      // 窗口销毁后 WebContentsView 可能已经不可用。
    }
    this.native.delete(id);
  }

  private deliver(viewId: string, channel: string, payload: unknown): void {
    const sink = this.sinks.get(viewId);
    if (sink) {
      sink(channel, payload);
      return;
    }
    const wc = this.native.get(viewId)?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(channel, payload);
  }
}

/** 窗口级系统视图：不进入 tabs 集合。 */
export class GlobalViews extends ViewHost {
  private readonly removedListeners = new Set<(record: ViewRecord) => void>();

  /** 把窗口自身的 webContents 注册成 shell view。 */
  attachShell(): ViewRecord | null {
    const id = `${this.wsId}:shell`;
    const existing = this.records.get(id);
    if (existing) return existing;

    const wcId = this.window.webContentsId();
    if (wcId === null) return null;

    const record = this.create({
      id,
      type: 'shell',
      externalId: String(wcId),
    });
    this.sinks.set(id, (channel, payload) =>
      this.window.send(channel, payload),
    );
    return record;
  }

  create(input: CreateViewInput): ViewRecord {
    if (isContentType(input.type)) {
      throw new Error(`content view ${input.type} belongs to tabs`);
    }
    const record = this.createRecord(input);
    if (input.url) this.mount(record, input);
    if (record.type === 'overlay' || record.type === 'capture') {
      this.setVisible(record.id, false);
    }
    return record;
  }

  list(): ViewRecord[] {
    return [...this.records.values()];
  }

  show(id: string, visible: boolean): void {
    this.setVisible(id, visible);
  }

  setState(id: string, state: ViewState): void {
    const record = this.records.get(id);
    if (!record || record.state === state) return;
    record.state = state;
  }

  onRemoved(listener: (record: ViewRecord) => void): () => void {
    this.removedListeners.add(listener);
    return () => {
      this.removedListeners.delete(listener);
    };
  }

  remove(id: string): ViewRecord | null {
    const record = super.remove(id);
    if (record) {
      for (const listener of Array.from(this.removedListeners))
        listener(record);
    }
    return record;
  }

  clear(): void {
    for (const id of this.ids()) this.remove(id);
    this.removedListeners.clear();
  }
}

/** 资源面板标签：只管理 page / web。 */
export class Tabs extends ViewHost {
  private activeId: string | null = null;
  private zoomFactor = 1;
  private readonly changeListeners = new Set<() => void>();
  private readonly removedListeners = new Set<(record: ViewRecord) => void>();

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
    for (const view of this.native.values()) {
      view.webContents.setZoomFactor(factor);
    }
  }

  create(input: CreateViewInput): ViewRecord {
    if (!isContentType(input.type)) {
      throw new Error(`tabs only host page / web, got ${input.type}`);
    }
    const record = this.createRecord(input);
    if (input.url) this.mount(record, input);
    this.native.get(record.id)?.webContents.setZoomFactor(this.zoomFactor);
    if (this.activeId) this.setVisible(record.id, false);
    else this.activate(record.id);
    this.window.applyTabLayout();
    this.notify();
    return record;
  }

  list(): ViewSnapshot[] {
    return [...this.records.values()].map(snapshotOf);
  }

  all(): ViewRecord[] {
    return [...this.records.values()];
  }

  findByContentPath(contentPath: string): ViewRecord | null {
    for (const record of this.records.values()) {
      if (record.contentPath === contentPath) return record;
    }
    return null;
  }

  findBySessionId(sessionId: string): ViewRecord | null {
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return null;
  }

  activeViewId(): string | null {
    return this.activeId;
  }

  findByReuseKey(reuseKey: string | null | undefined): ViewRecord | null {
    if (!reuseKey) return null;
    for (const record of this.records.values()) {
      if (record.reuseKey === reuseKey) return record;
    }
    return null;
  }

  /** 复用已有 tab：更新逻辑地址并导航到新 URL。 */
  replace(id: string, spec: ViewSpec, providerType: string | null): ViewRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`view ${id} not found`);
    record.type = spec.type;
    record.title = spec.title;
    record.url = spec.url;
    record.contentPath = spec.contentPath ?? null;
    record.sessionId = spec.sessionId ?? null;
    record.reuseKey = spec.reuseKey ?? null;
    record.providerType = providerType;
    record.state = 'loading';
    record.dirty = false;
    record.conflict = false;
    record.missing = false;
    const wc = this.native.get(id)?.webContents;
    if (wc && !wc.isDestroyed()) {
      void wc.loadURL(spec.url).catch((error: unknown) => {
        console.error('[app] view navigate failed', spec.url, error);
      });
    }
    this.notify();
    return record;
  }

  reload(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.state = 'loading';
    this.notify();
    this.native.get(id)?.webContents.reload();
  }

  activate(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.activeId = id;
    for (const other of this.records.values()) {
      other.active = other.id === id;
      this.setVisible(other.id, other.active);
    }
    this.focus(id);
    this.notify();
  }

  togglePin(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.pinned = !record.pinned;
    this.notify();
  }

  /** 把 fromId 移到 toId 之前；顺序即标签顺序。 */
  move(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const entries = [...this.records.entries()];
    const from = entries.findIndex(([id]) => id === fromId);
    const to = entries.findIndex(([id]) => id === toId);
    if (from === -1 || to === -1) return;
    const [entry] = entries.splice(from, 1);
    const target = entries.findIndex(([id]) => id === toId);
    entries.splice(target === -1 ? entries.length : target, 0, entry);
    this.records.clear();
    for (const [id, record] of entries) this.records.set(id, record);
    this.notify();
  }

  closeOthers(id: string): void {
    // 锚点必须存在：未知 id 不能退化成「关掉全部」。
    if (!this.records.has(id)) return;
    for (const other of this.ids()) {
      if (other !== id) this.remove(other, false);
    }
    this.activate(id);
  }

  closeLeft(id: string): void {
    const ids = this.ids();
    const index = ids.indexOf(id);
    if (index <= 0) return;
    for (const other of ids.slice(0, index)) this.remove(other, false);
    this.activate(id);
  }

  closeRight(id: string): void {
    const ids = this.ids();
    const index = ids.indexOf(id);
    if (index < 0) return;
    for (const other of ids.slice(index + 1)) this.remove(other, false);
    this.activate(id);
  }

  clearAll(): void {
    this.clear();
  }

  navigate(id: string, url: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.url = url;
    record.state = 'loading';
    void this.native
      .get(id)
      ?.webContents.loadURL(url)
      .catch((error: unknown) =>
        console.error('[app] navigate failed', url, error),
      );
    this.notify();
  }

  goBack(id: string): void {
    const history = this.native.get(id)?.webContents.navigationHistory;
    if (!history?.canGoBack()) return;
    history.goBack();
  }

  goForward(id: string): void {
    const history = this.native.get(id)?.webContents.navigationHistory;
    if (!history?.canGoForward()) return;
    history.goForward();
  }

  sendBus(id: string, message: unknown): void {
    const wc = this.native.get(id)?.webContents;
    if (wc && !wc.isDestroyed()) wc.send(CH_BUS, message);
  }

  setActionState(id: string, key: string, value: string): void {
    const record = this.records.get(id);
    if (!record) return;
    if (record.actionStates[key] === value) return;
    record.actionStates[key] = value;
    this.notify();
  }

  setState(id: string, state: ViewState): void {
    const record = this.records.get(id);
    if (!record || record.state === state) return;
    record.state = state;
    this.notify();
  }

  setTitle(id: string, title: string): void {
    const record = this.records.get(id);
    if (!record || record.title === title) return;
    record.title = title;
    this.notify();
  }

  setDirty(id: string, dirty: boolean): void {
    const record = this.records.get(id);
    if (!record) return;
    const clearConflict = !dirty && record.conflict;
    if (record.dirty === dirty && !clearConflict) return;
    record.dirty = dirty;
    if (!dirty) record.conflict = false;
    this.notify();
  }

  setMissing(id: string, missing: boolean): void {
    const record = this.records.get(id);
    if (!record || record.missing === missing) return;
    record.missing = missing;
    this.notify();
  }

  setConflict(id: string, conflict: boolean): void {
    const record = this.records.get(id);
    if (!record || record.conflict === conflict) return;
    record.conflict = conflict;
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  onRemoved(listener: (record: ViewRecord) => void): () => void {
    this.removedListeners.add(listener);
    return () => {
      this.removedListeners.delete(listener);
    };
  }

  remove(id: string, activateNext = true): ViewRecord | null {
    const record = super.remove(id);
    if (!record) return null;

    if (this.activeId === id) {
      this.activeId = null;
      if (!activateNext) {
        this.notify();
      } else {
        const remaining = this.list();
        const last = remaining[remaining.length - 1];
        if (last) this.activate(last.id);
        else this.notify();
      }
    } else {
      this.notify();
    }

    for (const listener of Array.from(this.removedListeners)) listener(record);
    return record;
  }

  clear(): void {
    for (const id of this.ids()) this.remove(id);
    this.changeListeners.clear();
    this.removedListeners.clear();
  }

  protected onViewState(viewId: string, state: ViewState): void {
    this.setState(viewId, state);
  }

  protected onViewTitle(viewId: string, title: string): void {
    this.setTitle(viewId, title);
  }

  protected onViewNavigate(viewId: string, url: string): void {
    const record = this.records.get(viewId);
    if (!record || record.url === url) return;
    record.url = url;
    this.notify();
  }

  private notify(): void {
    for (const listener of Array.from(this.changeListeners)) listener();
  }
}

/**
 * app-level 视图服务：跨窗口查找 + shell/tabs resource。
 *
 * 系统视图由 GlobalViews 管理，不进入 tabs 投影。
 */
export class Views {
  readonly domain: Domain;

  private readonly domains: DomainRegistry;
  private readonly windows: WindowManager;
  private readonly providers = new ViewProviders();
  private readonly resources = new Map<WorkspaceWindow, Resource>();
  private zoomFactor = 1;
  private readonly bindings = new Map<WorkspaceWindow, Array<() => void>>();
  private readonly emptyListeners = new Set<
    (window: WorkspaceWindow) => void
  >();
  private readonly offOpen: () => void;
  private readonly offClose: () => void;

  constructor(domains: DomainRegistry, windows: WindowManager) {
    this.domains = domains;
    this.windows = windows;
    this.domain = domains.define('shell');

    this.bindSession();
    this.offOpen = windows.onOpen((window) => this.bind(window));
    this.offClose = windows.onClose((window) => this.unbind(window));
    for (const window of windows.list()) this.bind(window);
  }

  /** 只更新记录里的地址，不重载页面（卡片切换、地址栏同步用）。 */
  locate(viewId: string, url: string, contentPath?: string): void {
    for (const window of this.windows.list()) {
      const record = window.tabs.get(viewId);
      if (!record) continue;
      record.url = url;
      if (contentPath) record.contentPath = contentPath;
      this.publish(window);
      return;
    }
  }

  /** 页面自述位置：按调用来源定位视图，页面不需要知道自己的 view id。 */
  private bindSession(): void {
    const resource = this.domain.resource('session');
    resource.command<{ card?: string }, null>('locate', (call) => {
      if (call.origin.type !== 'view') return null;
      const card = String(call.input?.card ?? '');
      this.locate(
        call.origin.viewId,
        workUrl('settings', card || undefined),
        '/settings',
      );
      return null;
    });
  }

  onEmpty(listener: (window: WorkspaceWindow) => void): () => void {
    this.emptyListeners.add(listener);
    return () => {
      this.emptyListeners.delete(listener);
    };
  }

  originOf(externalId: string): Origin | null {
    for (const window of this.windows.list()) {
      const origin =
        window.tabs.originOf(externalId) ?? window.global.originOf(externalId);
      if (origin) return origin;
    }
    return null;
  }

  get(viewId: string): ViewRecord | null {
    for (const window of this.windows.list()) {
      const record = window.tabs.get(viewId) ?? window.global.get(viewId);
      if (record) return record;
    }
    return null;
  }

  /** 视图的原生承载（tabs 或系统视图）；自动化按 viewId 取 webContents。 */
  nativeView(viewId: string): WebContentsView | null {
    for (const window of this.windows.list()) {
      const view =
        window.tabs.nativeView(viewId) ?? window.global.nativeView(viewId);
      if (view) return view;
    }
    return null;
  }

  send(viewId: string, update: DomainUpdate): void {
    for (const window of this.windows.list()) {
      if (window.tabs.get(viewId)) {
        window.tabs.send(viewId, update);
        return;
      }
      if (window.global.get(viewId)) {
        window.global.send(viewId, update);
        return;
      }
    }
  }

  list(): ViewSnapshot[] {
    return this.windows.list().flatMap((window) => window.tabs.list());
  }

  create(wsId: string, input: CreateViewInput): ViewRecord {
    const window = this.windows.get(wsId);
    if (!window) throw new CallFailure('unknown', `unknown workspace ${wsId}`);
    return window.tabs.create(input);
  }

  /** 注册页面提供者；由业务 domain 在组合根注册。 */
  provide(provider: ViewProvider): void {
    this.providers.register(provider);
  }

  /**
   * service 侧打开入口：业务 domain 调它，不暴露成 renderer command。
   *
   * provider.owner 负责归属；只有对应 service 能打开自己的页面。
   */
  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
    for (const window of this.windows.list()) {
      window.tabs.setZoomFactor(factor);
    }
  }

  async open(
    wsId: string,
    owner: string,
    target: OpenTarget,
  ): Promise<ViewRecord> {
    const window = this.windows.get(wsId);
    if (!window) throw new CallFailure('unknown', `unknown workspace ${wsId}`);

    const provider = this.providers.get(target.type);
    if (!provider) {
      throw new CallFailure('unknown', `no view provider for ${target.type}`);
    }
    if (provider.owner && provider.owner !== owner) {
      throw new CallFailure(
        'denied',
        `only ${provider.owner} can open ${target.type}`,
      );
    }

    const spec = await provider.resolve(target);
    const contentPath = spec.contentPath ?? `${spec.type}:${spec.url}`;

    const existing = window.tabs.findByContentPath(contentPath);
    if (existing) {
      window.tabs.activate(existing.id);
      return existing;
    }

    const reusable = window.tabs.findByReuseKey(spec.reuseKey);
    if (reusable) {
      window.tabs.replace(reusable.id, { ...spec, contentPath }, target.type);
      window.tabs.activate(reusable.id);
      return reusable;
    }

    window.tabs.setZoomFactor(this.zoomFactor);
    const record = window.tabs.create({
      type: spec.type,
      title: spec.title,
      url: spec.url,
      contentPath,
      sessionId: spec.sessionId,
      preload: spec.preload,
      partition: spec.partition,
      reuseKey: spec.reuseKey,
      providerType: target.type,
    });
    window.tabs.activate(record.id);
    return record;
  }

  async refresh(viewId: string): Promise<void> {
    const record = this.get(viewId);
    if (!record) throw new CallFailure('unknown', `unknown view ${viewId}`);
    await this.providers.refresh(record);
    this.tabsHostOf(viewId).tabs.reload(viewId);
  }

  /** 窗口关闭前释放该窗口所有 tab 的 provider 资源。 */
  release(window: WorkspaceWindow): void {
    for (const record of window.tabs.all()) this.providers.release(record);
  }

  activate(viewId: string): void {
    this.tabsHostOf(viewId).tabs.activate(viewId);
  }

  close(viewId: string): void {
    this.tabsHostOf(viewId).tabs.remove(viewId);
  }

  togglePin(viewId: string): void {
    this.tabsHostOf(viewId).tabs.togglePin(viewId);
  }

  move(fromId: string, toId: string): void {
    this.tabsHostOf(fromId).tabs.move(fromId, toId);
  }

  closeOthers(viewId: string): void {
    this.tabsHostOf(viewId).tabs.closeOthers(viewId);
  }

  closeLeft(viewId: string): void {
    this.tabsHostOf(viewId).tabs.closeLeft(viewId);
  }

  closeRight(viewId: string): void {
    this.tabsHostOf(viewId).tabs.closeRight(viewId);
  }

  closeAll(): void {
    for (const window of this.windows.list()) window.tabs.clearAll();
  }

  goBack(viewId: string): void {
    this.tabsHostOf(viewId).tabs.goBack(viewId);
  }

  goForward(viewId: string): void {
    this.tabsHostOf(viewId).tabs.goForward(viewId);
  }

  navigate(viewId: string, url: string): void {
    this.tabsHostOf(viewId).tabs.navigate(viewId, url);
  }

  sendAction(viewId: string, action: string): void {
    this.tabsHostOf(viewId).tabs.sendBus(viewId, {
      type: 'action',
      id: action,
    });
  }

  setActionState(viewId: string, key: string, value: string): void {
    this.tabsHostOf(viewId).tabs.setActionState(viewId, key, value);
  }

  setState(viewId: string, state: ViewState): void {
    this.tabsHostOf(viewId).tabs.setState(viewId, state);
  }

  setDirty(viewId: string, dirty: boolean): void {
    this.tabsHostOf(viewId).tabs.setDirty(viewId, dirty);
  }

  setMissing(viewId: string, missing: boolean): void {
    this.tabsHostOf(viewId).tabs.setMissing(viewId, missing);
  }

  setConflict(viewId: string, conflict: boolean): void {
    this.tabsHostOf(viewId).tabs.setConflict(viewId, conflict);
  }

  dispose(): void {
    this.offOpen();
    this.offClose();
    for (const window of this.bindings.keys()) this.unbind(window);
  }

  private bind(window: WorkspaceWindow): void {
    if (this.bindings.has(window)) return;
    const resource = this.domain.resource(`tabs:${window.wsId}`);
    this.setup(resource, window);
    this.resources.set(window, resource);

    const offChange = window.tabs.onChange(() => {
      this.publish(window);
      if (window.tabs.all().length === 0) {
        for (const listener of this.emptyListeners) listener(window);
      }
    });
    const offTabsRemoved = window.tabs.onRemoved((record) => {
      this.providers.release(record);
      this.domains.unsubscribeView(record.id);
    });
    const offGlobalRemoved = window.global.onRemoved((record) =>
      this.domains.unsubscribeView(record.id),
    );
    this.bindings.set(window, [offChange, offTabsRemoved, offGlobalRemoved]);
    this.publish(window);
  }

  private setup(resource: Resource, window: WorkspaceWindow): void {
    resource.snapshot(() => ({ list: window.tabs.list() }));
    resource.command<string, null>('activate', (call) => {
      window.tabs.activate(String(call.input));
      return null;
    });
    resource.command<string, null>('close', (call) => {
      window.tabs.remove(String(call.input));
      return null;
    });
    resource.command<string, null>('togglePin', (call) => {
      window.tabs.togglePin(String(call.input));
      return null;
    });
    resource.command<{ fromId: string; toId: string }, null>('move', (call) => {
      window.tabs.move(call.input.fromId, call.input.toId);
      return null;
    });
    resource.command<string, null>('closeOthers', (call) => {
      window.tabs.closeOthers(String(call.input));
      return null;
    });
    resource.command<string, null>('closeToLeft', (call) => {
      window.tabs.closeLeft(String(call.input));
      return null;
    });
    resource.command<string, null>('closeToRight', (call) => {
      window.tabs.closeRight(String(call.input));
      return null;
    });
    resource.command<null, null>('closeAll', () => {
      window.tabs.clearAll();
      return null;
    });
    resource.command<string, null>('goBack', (call) => {
      window.tabs.goBack(String(call.input));
      return null;
    });
    resource.command<string, null>('goForward', (call) => {
      window.tabs.goForward(String(call.input));
      return null;
    });
    resource.command<{ id: string; url: string }, null>('navigate', (call) => {
      window.tabs.navigate(call.input.id, call.input.url);
      return null;
    });
    resource.command<{ id: string; action: string }, null>('action', (call) => {
      window.tabs.sendBus(call.input.id, {
        type: 'action',
        id: call.input.action,
      });
      return null;
    });
    resource.command<{ id: string; action: string }, null>(
      'runAction',
      (call) => {
        window.tabs.sendBus(call.input.id, {
          type: 'action',
          id: call.input.action,
        });
        return null;
      },
    );
    resource.command<string, null>('refresh', async (call) => {
      await this.refresh(String(call.input));
      return null;
    });
    resource.notify('ready', (call) =>
      window.tabs.setState(String(call.input), 'ready'),
    );
    resource.notify('dirty', (call) => {
      const input = call.input as { viewId?: string; dirty?: boolean };
      if (input.viewId)
        window.tabs.setDirty(input.viewId, Boolean(input.dirty));
    });
    resource.notify('missing', (call) => {
      const input = call.input as { viewId?: string; missing?: boolean };
      if (input.viewId)
        window.tabs.setMissing(input.viewId, Boolean(input.missing));
    });
    resource.notify('conflict', (call) => {
      const input = call.input as { viewId?: string; conflict?: boolean };
      if (input.viewId)
        window.tabs.setConflict(input.viewId, Boolean(input.conflict));
    });
  }

  private unbind(window: WorkspaceWindow): void {
    const offs = this.bindings.get(window);
    if (!offs) return;
    for (const off of offs) off();
    this.bindings.delete(window);
    this.resources.delete(window);
    this.domain.remove(`tabs:${window.wsId}`);
  }

  private publish(window: WorkspaceWindow): void {
    this.resources.get(window)?.patch({ list: window.tabs.list() });
  }

  private tabsHostOf(viewId: string): WorkspaceWindow {
    for (const window of this.windows.list()) {
      if (window.tabs.get(viewId)) return window;
    }
    throw new CallFailure('unknown', `unknown tabs view ${viewId}`);
  }
}

function isContentType(type: ViewType): boolean {
  return type === 'page' || type === 'web';
}

function snapshotOf(record: ViewRecord): ViewSnapshot {
  return {
    id: record.id,
    wsId: record.wsId,
    tabKey: record.contentPath ?? record.id,
    type: record.type,
    title: record.title,
    url: record.url,
    contentPath: record.contentPath,
    state: record.state,
    active: record.active,
    pinned: record.pinned,
    dirty: record.dirty,
    missing: record.missing,
    conflict: record.conflict,
    actionStates: record.actionStates,
  };
}
