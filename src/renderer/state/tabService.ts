/**
 * 视图宿主适配层（zustand）—— docs/architecture.md §5.1。
 *
 * 职责：与视图宿主通信（getOrCreate / destroy / setActive / reload / syncBounds /
 * sendToView / broadcast）、生命周期状态机（FSM 槽）、内容投递、总线转译；
 * 把视图事实投影进 tabs 集合（state/tabs.ts）——本层不维护第二份 tab 列表。
 *
 * 状态机纪律（architecture.md §5.1.3）：
 *   - 内容投递前置：CONTENT 仅在 ready 态接受（排队，不发进黑洞）
 *   - 就绪幂等收敛：任何状态收到 LOADED → ready（reload/重连统一）
 *   - RELOAD 转换内置清投递记录
 *   - 命令守卫：槽不存在 / 已关闭 → no-op
 */
import { create } from 'zustand';
import type {
  BusMessage,
  DocumentContent,
  DocumentMeta,
  ExtensionDef,
  PluginInfo,
} from '../../shared/types';
import { agentAPI } from '../api/bridge';
import { eventBus } from './eventBus';
import { createMachine, type Machine } from './machine';
import {
  useTabsStore,
  type TabEntry,
  type TabType,
  type ViewState,
} from './tabs';
import { setUiState, useUiStore } from './uiState';

// ─── InstanceFSM ──────────────────────────────────────────

type InstanceEvent = 'LOADED' | 'ASSIGN_DOC' | 'CONTENT' | 'RELOAD' | 'FAIL';

/** 转换表（architecture.md §5.1）——评审表 = 评审代码。 */
const INSTANCE_TRANSITIONS: Record<string, ViewState> = {
  'creating:LOADED': 'ready',
  'creating:FAIL': 'error',
  'creating:ASSIGN_DOC': 'creating',
  'loading:LOADED': 'ready',
  'loading:ASSIGN_DOC': 'loading',
  'ready:ASSIGN_DOC': 'ready',
  'ready:LOADED': 'ready',
  'ready:CONTENT': 'contentDelivered',
  'ready:RELOAD': 'reloading',
  'contentDelivered:RELOAD': 'reloading',
  'contentDelivered:LOADED': 'ready',
  'contentDelivered:CONTENT': 'contentDelivered',
  'reloading:LOADED': 'ready',
  'error:RELOAD': 'reloading',
};

interface InstanceSlot {
  id: string;
  fsm: Machine<ViewState, InstanceEvent>;
  doc: DocumentMeta | null;
  content: DocumentContent | null;
  /** 待投递内容（CONTENT 在非 ready 态到达时排队，ready 后统一投）。 */
  queuedContent: DocumentContent | null;
  /** 已实际投出的内容（外部变更重投的去重基准）。 */
  lastDelivered: string | null;
}

/** 实例槽（id → FSM + 文档上下文）。生命周期 = 实例存在的全部时间。 */
const slots = new Map<string, InstanceSlot>();

/** 视图状态 → tabs 投影（FSM 唯一出口）。 */
function projectState(instanceId: string, state: ViewState): void {
  useTabsStore.getState().setState(instanceId, state);
}

/** 注册实例槽（创建 / 恢复时）。 */
function registerSlot(
  instanceId: string,
  doc: DocumentMeta | null,
  initial: ViewState,
): InstanceSlot {
  const slot: InstanceSlot = {
    id: instanceId,
    doc,
    content: null,
    queuedContent: null,
    lastDelivered: null,
    fsm: createMachine<ViewState, InstanceEvent>({
      id: `instance:${instanceId.slice(0, 8)}`,
      initial,
      transitions: INSTANCE_TRANSITIONS,
      onEnter: {
        ready: (from) => {
          projectState(instanceId, 'ready');
          eventBus.emit({ type: 'instance:ready', instanceId });
          const s = slots.get(instanceId);
          // 从 reloading/contentDelivered 进入 ready（webview 刚重启、内容已丢）：必须强制重投
          const contentLost =
            from === 'reloading' || from === 'contentDelivered';
          if (s?.queuedContent && s.doc) {
            deliverContent(instanceId, s.doc, s.queuedContent);
          } else if (contentLost && s?.doc) {
            void redeliverContent(instanceId);
          }
        },
        reloading: () => {
          projectState(instanceId, 'reloading');
          // RELOAD 转换副作用：清投递记录
          const s = slots.get(instanceId);
          if (s) s.queuedContent = null;
        },
        loading: () => projectState(instanceId, 'loading'),
        creating: () => projectState(instanceId, 'creating'),
        error: () => projectState(instanceId, 'error'),
        contentDelivered: () => projectState(instanceId, 'contentDelivered'),
      },
    }),
  };
  slots.set(instanceId, slot);
  projectState(instanceId, initial);
  return slot;
}

/** 内容投递：写状态机 CONTENT 事件（非 ready 态自动排队）。 */
function deliverContent(
  instanceId: string,
  doc: DocumentMeta,
  content: DocumentContent,
): void {
  const s = slots.get(instanceId);
  if (!s) return;
  if (!s.fsm.is('ready') && !s.fsm.is('contentDelivered')) {
    s.queuedContent = content;
    return;
  }
  void agentAPI.extensions.sendToView(instanceId, 'data:content', {
    content: content.content,
    docId: doc.id,
    ext: doc.ext,
    type: doc.type,
    meta: doc,
  });
  s.lastDelivered = content.content;
  s.fsm.send('CONTENT');
  eventBus.emit({ type: 'instance:contentDelivered', instanceId });
}

/** 绕过编排的自重启兜底：内容已随 webview 重启丢失，从后端重拉重投。 */
async function redeliverContent(instanceId: string): Promise<void> {
  const slot = slots.get(instanceId);
  const tab = useTabsStore
    .getState()
    .tabs.find((t) => t.instanceId === instanceId);
  const doc = slot?.doc ?? tab?.document ?? null;
  if (!slot || !doc) return;
  const result = await agentAPI.documents.open(doc.id);
  if (!result || !slots.get(instanceId)) return;
  deliverContent(instanceId, result.meta, result.content);
}

// ─── tab 构造 ─────────────────────────────────────────────

function makeTab(params: {
  tabKey: string;
  instanceId: string;
  type: TabType;
  extensionId: string;
  title: string;
  url: string;
  state: ViewState;
  document?: DocumentMeta;
  plugin?: PluginInfo;
  raw?: boolean;
  temporary?: boolean;
}): TabEntry {
  return {
    tabKey: params.tabKey,
    instanceId: params.instanceId,
    type: params.type,
    extensionId: params.extensionId,
    title: params.title,
    url: params.url,
    state: params.state,
    dirty: false,
    pinned: false,
    document: params.document,
    plugin: params.plugin,
    raw: params.raw,
    temporary: params.temporary,
  };
}

// ─── store ────────────────────────────────────────────────

interface TabServiceState {
  defs: ExtensionDef[];
  /** 最近一次打开的内容（内容投递编排的输入）。 */
  previewDoc: DocumentMeta | null;
  previewContent: DocumentContent | null;

  init: () => Promise<void>;
  openDocument: (doc: DocumentMeta, content: DocumentContent) => Promise<void>;
  openPluginConfig: (
    plugin: PluginInfo,
    labelOverride?: string,
  ) => Promise<void>;
  openPluginHome: (plugin: PluginInfo) => Promise<void>;
  closeInstance: (instanceId: string) => Promise<void>;
  closeAll: () => Promise<void>;
  closeOthers: (anchorId: string) => Promise<void>;
  closeToLeft: (anchorId: string) => Promise<void>;
  closeToRight: (anchorId: string) => Promise<void>;
  selectInstance: (instanceId: string) => Promise<void>;
  activateInstance: (instanceId: string) => Promise<void>;
  reloadInstance: (instanceId: string) => Promise<void>;
  toggle: () => void;
  setInteractiveElements: (instanceId: string, on: boolean) => void;
  setLayout: (instanceId: string, layout: string) => void;

  hasOpenFiles: () => boolean;
  defForInstance: (instanceId: string) => ExtensionDef | null;
  isReady: (instanceId: string) => boolean;
  isVisible: () => boolean;
}

export const useTabServiceStore = create<TabServiceState>()((set, get) => ({
  defs: [],
  previewDoc: null,
  previewContent: null,

  setLayout: (instanceId, layout) => {
    useTabsStore.getState().patch(instanceId, { layout });
  },

  hasOpenFiles: () =>
    useTabsStore.getState().tabs.length > 0 || get().previewDoc != null,

  defForInstance: (instanceId) => {
    const tab = useTabsStore
      .getState()
      .tabs.find((t) => t.instanceId === instanceId);
    if (!tab) return null;
    return get().defs.find((d) => d.id === tab.extensionId) ?? null;
  },

  isVisible: () =>
    (useTabsStore.getState().tabs.length > 0 || get().previewDoc != null) &&
    !useUiStore.getState().panelCollapsed,

  isReady: (instanceId) => {
    const state = useTabsStore
      .getState()
      .tabs.find((t) => t.instanceId === instanceId)?.state;
    return state === 'ready' || state === 'contentDelivered';
  },

  init: async () => {
    const [list, defs, docs] = await Promise.all([
      agentAPI.extensions.list(),
      agentAPI.extensions.definitions(),
      agentAPI.documents.list(),
    ]);
    set({ defs });

    if (list.length > 0) {
      // 重建实例槽 + tab 集合：宿主 loaded 标志 → 恢复即就绪
      const tabs = useTabsStore.getState();
      for (const inst of list) {
        const doc = inst.documentId
          ? (docs.find((x) => x.id === inst.documentId) ?? null)
          : null;
        const type: TabType = doc ? 'document' : 'plugin';
        const tabKey = doc
          ? `document:${doc.id}`
          : `plugin:${inst.pluginId}:${inst.extensionId}`;
        tabs.openOrActivate(
          makeTab({
            tabKey,
            instanceId: inst.instanceId,
            type,
            extensionId: inst.extensionId,
            title: inst.label,
            url: inst.url,
            state: inst.loaded ? 'ready' : 'loading',
            document: doc ?? undefined,
          }),
        );
        registerSlot(inst.instanceId, doc, inst.loaded ? 'ready' : 'loading');
      }
      const activeId = list[list.length - 1].instanceId;
      useTabsStore.getState().activate(activeId);
      await agentAPI.extensions.setActive(activeId);
    }

    // webview 总线 → FSM 事件转译
    window.addEventListener('ext:bus:message', (e) => {
      const msg = (e as CustomEvent<BusMessage>).detail;
      if (msg) handleBusMessage(msg);
    });
  },

  /** 打开文档：按 ext/type 匹配扩展视图。 */
  openDocument: async (doc, content) => {
    setUiState({ panelCollapsed: false });
    set({ previewDoc: doc, previewContent: content });

    const current = get();
    const defs =
      current.defs.length > 0
        ? current.defs
        : await agentAPI.extensions.definitions();
    set({ defs });

    // 渲染器选择纯按扩展名匹配；兜底 text-editor
    const def =
      defs.find((x) => x.extensions.includes(doc.ext)) ??
      defs.find((x) => x.id === 'text-editor');
    if (!def) {
      console.warn(`No extension found for ext: ${doc.ext}`);
      return;
    }

    const instanceId = await agentAPI.extensions.getOrCreate(def.id, {
      documentId: doc.id,
      label: doc.title,
    });
    const list = await agentAPI.extensions.list();
    const mainFact = list.find((i) => i.instanceId === instanceId);
    useTabsStore.getState().openOrActivate(
      makeTab({
        tabKey: `document:${doc.id}`,
        instanceId,
        type: 'document',
        extensionId: def.id,
        title: doc.title,
        url: doc.url ?? doc.path ?? doc.title,
        state: mainFact?.loaded ? 'ready' : 'loading',
        document: doc,
      }),
    );
    await agentAPI.extensions.setActive(instanceId);

    // FSM：已有槽（同文档复用）→ ASSIGN_DOC；新实例 → 建槽。
    const existing = slots.get(instanceId);
    if (existing) {
      existing.doc = doc;
      existing.fsm.send('ASSIGN_DOC');
    } else {
      registerSlot(instanceId, doc, mainFact?.loaded ? 'ready' : 'loading');
    }
    // 事实校验：不依赖事件时机，直接从宿主事实收敛（loaded=true 则就绪）
    if (!get().isReady(instanceId)) {
      await new Promise((r) => setTimeout(r, 300));
      const fresh = await agentAPI.extensions.list();
      const freshFact = fresh.find((i) => i.instanceId === instanceId);
      const slot = slots.get(instanceId);
      if (slot && freshFact?.loaded && slot.fsm.is('loading'))
        slot.fsm.send('LOADED');
    }
    deliverContent(instanceId, doc, content);
    eventBus.emit({ type: 'resource:opened', docId: doc.id, instanceId });
  },

  /** 打开插件配置页。 */
  openPluginConfig: async (plugin, labelOverride) => {
    setUiState({ panelCollapsed: false });
    const current = get();
    const defs =
      current.defs.length > 0
        ? current.defs
        : await agentAPI.extensions.definitions();
    set({ defs });
    // config 扩展定位：设置页走主进程设置能力，不经此路径
    const def =
      defs.find((x) => x.id === `${plugin.id}-config`) ||
      defs.find((x) => x.id === plugin.id);
    if (!def) {
      console.warn(`No config extension for plugin: ${plugin.id}`);
      return;
    }
    const instanceId = await agentAPI.extensions.getOrCreate(def.id, {
      label: labelOverride ?? plugin.name,
    });
    const list = await agentAPI.extensions.list();
    const mainFact = list.find((i) => i.instanceId === instanceId);
    useTabsStore.getState().openOrActivate(
      makeTab({
        tabKey: `plugin:${plugin.id}:${def.id}`,
        instanceId,
        type: 'plugin',
        extensionId: def.id,
        title: labelOverride ?? plugin.name,
        url: `app://plugin/${plugin.id}`,
        state: mainFact?.loaded ? 'ready' : 'loading',
        plugin,
      }),
    );
    await agentAPI.extensions.setActive(instanceId);
    if (!slots.has(instanceId))
      registerSlot(instanceId, null, mainFact?.loaded ? 'ready' : 'loading');
    // 配置页内容（插件信息）
    setTimeout(() => {
      void agentAPI.extensions.sendToView(instanceId, 'data:content', {
        content: '',
        meta: plugin,
        skills: [],
      });
      slots.get(instanceId)?.fsm.send('CONTENT');
    }, 300);
  },

  /** 打开插件首页（<pluginId>-home 约定扩展）。 */
  openPluginHome: async (plugin) => {
    setUiState({ panelCollapsed: false });
    const current = get();
    const defs =
      current.defs.length > 0
        ? current.defs
        : await agentAPI.extensions.definitions();
    set({ defs });
    const def = defs.find((x) => x.id === `${plugin.id}-home`);
    if (!def) {
      console.warn(`No home extension for plugin: ${plugin.id}`);
      return;
    }
    const instanceId = await agentAPI.extensions.getOrCreate(def.id, {
      label: plugin.name,
    });
    const list = await agentAPI.extensions.list();
    const mainFact = list.find((i) => i.instanceId === instanceId);
    useTabsStore.getState().openOrActivate(
      makeTab({
        tabKey: `plugin:${plugin.id}:${def.id}`,
        instanceId,
        type: 'plugin',
        extensionId: def.id,
        title: plugin.name,
        url: `app://plugin/${plugin.id}`,
        state: mainFact?.loaded ? 'ready' : 'loading',
        plugin,
      }),
    );
    await agentAPI.extensions.setActive(instanceId);
    if (!slots.has(instanceId))
      registerSlot(instanceId, null, mainFact?.loaded ? 'ready' : 'loading');
  },

  closeInstance: async (instanceId) => {
    const tab = useTabsStore
      .getState()
      .tabs.find((t) => t.instanceId === instanceId);
    await agentAPI.extensions.destroy(instanceId);
    slots.delete(instanceId);
    // 集合侧关闭（负责重选激活：右邻优先 → 左邻 → null）
    const nextActive = useTabsStore.getState().close(instanceId);
    const remaining = useTabsStore.getState().tabs.length;
    if (remaining === 0) {
      set({ previewDoc: null, previewContent: null });
      await agentAPI.extensions.setActive(null);
    } else if (nextActive !== null) {
      await agentAPI.extensions.setActive(nextActive);
    }
    eventBus.emit({
      type: 'resource:closed',
      docId: tab?.document?.id ?? null,
      instanceId,
    });
  },

  closeAll: async () => {
    const ids = useTabsStore
      .getState()
      .tabs.filter((t) => !t.pinned)
      .map((t) => t.instanceId);
    for (const id of ids) await get().closeInstance(id);
    // 固定项仍在时不销毁；集合空则清预览
    if (useTabsStore.getState().tabs.length === 0) {
      set({ previewDoc: null, previewContent: null });
      await agentAPI.extensions.setActive(null);
    }
  },

  /** 关闭其他：保留锚点与固定项，结束后锚点为当前。 */
  closeOthers: async (anchorId) => {
    const ids = useTabsStore
      .getState()
      .tabs.filter((t) => t.instanceId !== anchorId && !t.pinned)
      .map((t) => t.instanceId);
    for (const id of ids) await get().closeInstance(id);
    if (useTabsStore.getState().tabs.some((t) => t.instanceId === anchorId)) {
      await get().selectInstance(anchorId);
    }
  },

  /** 关闭左侧（跳过固定项）。 */
  closeToLeft: async (anchorId) => {
    const list = useTabsStore.getState().tabs;
    const idx = list.findIndex((t) => t.instanceId === anchorId);
    if (idx <= 0) return;
    const ids = list
      .slice(0, idx)
      .filter((t) => !t.pinned)
      .map((t) => t.instanceId);
    for (const id of ids) await get().closeInstance(id);
    if (useTabsStore.getState().tabs.some((t) => t.instanceId === anchorId)) {
      await get().selectInstance(anchorId);
    }
  },

  /** 关闭右侧（跳过固定项）。 */
  closeToRight: async (anchorId) => {
    const list = useTabsStore.getState().tabs;
    const idx = list.findIndex((t) => t.instanceId === anchorId);
    if (idx < 0 || idx === list.length - 1) return;
    const ids = list
      .slice(idx + 1)
      .filter((t) => !t.pinned)
      .map((t) => t.instanceId);
    for (const id of ids) await get().closeInstance(id);
    if (useTabsStore.getState().tabs.some((t) => t.instanceId === anchorId)) {
      await get().selectInstance(anchorId);
    }
  },

  selectInstance: async (instanceId) => {
    useTabsStore.getState().activate(instanceId);
    await agentAPI.extensions.setActive(instanceId);
  },

  /** 激活已存在的实例（侧边栏「临时网页」条目点击）。 */
  activateInstance: async (instanceId) => {
    setUiState({ panelCollapsed: false });
    useTabsStore.getState().activate(instanceId);
    await agentAPI.extensions.setActive(instanceId);
  },

  /** 真实重载：FSM 驱动（RELOAD 转换内置清投递记录）。 */
  reloadInstance: async (instanceId) => {
    const slot = slots.get(instanceId);
    if (!slot || !slot.fsm.can('RELOAD')) return;
    await agentAPI.extensions.reload(instanceId);
  },

  toggle: () => {
    setUiState({ panelCollapsed: !useUiStore.getState().panelCollapsed });
  },

  /** 可交互元素显隐的乐观更新（真相在宿主：view:annotated 广播随后对齐）。 */
  setInteractiveElements: (instanceId, on) => {
    useTabsStore.getState().patch(instanceId, { interactiveElements: on });
  },
}));

// ─── 总线消息处理 ──────────────────────────────────────────

function handleBusMessage(msg: BusMessage): void {
  const tabs = useTabsStore.getState();
  const slot = msg.fromInstanceId ? slots.get(msg.fromInstanceId) : undefined;

  if (msg.channel === 'data:loaded' && slot) {
    // 绕过编排的自重启：FSM 在 contentDelivered 却收到 LOADED = webview 重启过、内容已丢
    const bypassed = slot.fsm.is('contentDelivered');
    slot.fsm.send('LOADED');
    if (bypassed) void redeliverContent(slot.id);
    void agentAPI.extensions.sendToView(slot.id, 'event:theme', {
      mode: useUiStore.getState().theme,
    });
    return;
  }
  if (msg.channel === 'view:reloading' && slot) {
    if (!slot.fsm.is('reloading')) slot.fsm.send('RELOAD');
    void redeliverContent(slot.id);
    return;
  }
  if (msg.channel === 'view:created') {
    void (async () => {
      const instanceId = msg.fromInstanceId;
      if (!instanceId || slots.has(instanceId)) return;
      const list = await agentAPI.extensions.list();
      const inst = list.find((i) => i.instanceId === instanceId);
      if (!inst) return;
      useTabsStore.getState().openOrActivate(
        makeTab({
          tabKey: `browser:${inst.url || instanceId}`,
          instanceId,
          type: 'browser',
          extensionId: inst.extensionId,
          title: inst.label,
          url: inst.url,
          state: inst.loaded ? 'ready' : 'loading',
          raw: true,
          temporary: inst.temporary,
        }),
      );
      registerSlot(instanceId, null, inst.loaded ? 'ready' : 'loading');
    })();
    return;
  }
  if (msg.channel === 'view:active') {
    const activeId =
      (msg.payload as { instanceId?: string | null } | null)?.instanceId ??
      null;
    if (activeId && activeId !== tabs.activeId) {
      tabs.activate(activeId);
      void agentAPI.extensions.list().then((list) => {
        useTabsStore.getState().syncFromHost(
          list.map((inst) => {
            const old = useTabsStore
              .getState()
              .tabs.find((t) => t.instanceId === inst.instanceId);
            return (
              old ??
              makeTab({
                tabKey: `browser:${inst.url || inst.instanceId}`,
                instanceId: inst.instanceId,
                type: 'browser',
                extensionId: inst.extensionId,
                title: inst.label,
                url: inst.url,
                state: inst.loaded ? 'ready' : 'loading',
                raw: true,
                temporary: inst.temporary,
              })
            );
          }),
        );
      });
    }
    return;
  }
  if (msg.channel === 'view:navigated') {
    const navId = msg.fromInstanceId;
    const payload = msg.payload as {
      url?: string;
      title?: string;
      annotated?: boolean;
      temporary?: boolean;
    } | null;
    if (navId && payload?.url) {
      tabs.patch(navId, {
        url: payload.url,
        title: payload.title || undefined,
        interactiveElements: payload.annotated ?? false,
        temporary: payload.temporary,
      });
    }
    return;
  }
  if (msg.channel === 'view:refresh') {
    void agentAPI.extensions.list().then((list) => {
      useTabsStore.getState().syncFromHost(
        list.map((inst) => {
          const old = useTabsStore
            .getState()
            .tabs.find((t) => t.instanceId === inst.instanceId);
          return (
            old ??
            makeTab({
              tabKey: `browser:${inst.url || inst.instanceId}`,
              instanceId: inst.instanceId,
              type: 'browser',
              extensionId: inst.extensionId,
              title: inst.label,
              url: inst.url,
              state: inst.loaded ? 'ready' : 'loading',
              raw: true,
              temporary: inst.temporary,
            })
          );
        }),
      );
    });
    return;
  }
  if (msg.channel === 'view:annotated') {
    const annId = msg.fromInstanceId;
    const payload = msg.payload as { annotated?: boolean } | null;
    if (annId) tabs.patch(annId, { interactiveElements: !!payload?.annotated });
    return;
  }
  if (msg.channel === 'view:destroyed') {
    // 外部销毁（绕过 store 的命令路径）：对齐集合（tab 消失、激活重选）
    const goneId = (msg.payload as { instanceId?: string } | null)?.instanceId;
    if (goneId) {
      slots.delete(goneId);
      useTabsStore.getState().close(goneId);
    }
    return;
  }
  if (msg.channel === 'action:dirty') {
    const payload = msg.payload as { docId?: string; dirty?: boolean } | null;
    const dirtyDocId = payload?.docId;
    if (dirtyDocId) {
      // docId → 打开的 document tab
      const tab = useTabsStore
        .getState()
        .tabs.find((t) => t.document?.id === dirtyDocId);
      if (tab)
        useTabsStore.getState().setDirty(tab.instanceId, !!payload?.dirty);
    }
    return;
  }
  if (msg.channel === 'action:save') {
    const payload = msg.payload as { docId?: string; content?: string } | null;
    if (payload?.docId && payload.content != null) {
      void agentAPI.documents.update(payload.docId, payload.content);
    }
    return;
  }
  if (msg.channel === 'event:layout') {
    const layoutId = msg.fromInstanceId;
    const payload = msg.payload as { layout?: string } | null;
    if (layoutId && payload?.layout)
      tabs.patch(layoutId, { layout: payload.layout });
  }
}

// ─── 全局编排（bootstrap 挂载） ─────────────────────────────

/**
 * 内容就绪编排：previewDoc+content 就绪且实例已就绪时投递。
 * 订阅式：只在内容尚未投出时补投，避免每次状态变化重复下发。
 */
export function bindContentDelivery(): void {
  useTabServiceStore.subscribe((s) => {
    const doc = s.previewDoc;
    const content = s.previewContent;
    if (!doc || !content) return;
    const tab = useTabsStore
      .getState()
      .tabs.find((t) => t.document?.id === doc.id);
    if (!tab) return;
    const slot = slots.get(tab.instanceId);
    if (!slot) return;
    if (slot.fsm.is('ready')) {
      if (slot.lastDelivered !== content.content)
        deliverContent(tab.instanceId, doc, content);
    } else {
      slot.queuedContent = content;
    }
  });
}

/** 主题变化广播给全部扩展实例。 */
export function bindThemeBroadcast(): void {
  let lastTheme = useUiStore.getState().theme;
  useUiStore.subscribe((s) => {
    if (s.theme !== lastTheme) {
      lastTheme = s.theme;
      void agentAPI.extensions.broadcast('event:theme', { mode: s.theme });
    }
  });
}

/**
 * 外部变更自动重投（生成式闭环）：agent 写盘后，已打开且非脏的本地 html 文档
 * 自动重拉重投 → 预览即时刷新；脏实例不覆盖（保护未保存手改）。
 */
export function bindExternalContentSync(): void {
  agentAPI.documents.onRefresh(() => {
    void (async () => {
      const tabs = useTabsStore.getState().tabs;
      for (const tab of tabs) {
        const doc = tab.document;
        if (!doc) continue;
        if (doc.source !== 'local' || (doc.ext !== 'html' && doc.ext !== 'htm'))
          continue;
        if (tab.dirty) continue;
        const slot = slots.get(tab.instanceId);
        if (!slot || !(slot.fsm.is('ready') || slot.fsm.is('contentDelivered')))
          continue;
        const result = await agentAPI.documents.open(doc.id).catch(() => null);
        if (!result || !slots.has(tab.instanceId)) continue;
        if (result.content.content === (slot.lastDelivered ?? '')) continue;
        deliverContent(tab.instanceId, result.meta, result.content);
      }
    })();
  });
}
