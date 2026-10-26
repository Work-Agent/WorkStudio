/**
 * Tabs 域（zustand）—— 中栏打开集合（一个 tab = 一个视图实例）。
 *
 * 职责边界（docs/architecture.md §5.1）：纯集合语义——顺序 / 激活 / 固定 / 脏态 /
 * 生命周期状态投影；不触达 IPC、总线与视图宿主。视图事实由 tabService（宿主适配层）
 * 投影进来；tab 集合是 TabsBar / Sidebar 展开项 / 地址栏的共同数据源。
 */
import { create } from 'zustand';
import type { DocumentMeta, PluginInfo } from '../../shared/types';

/** 视图生命周期状态（architecture.md §5.1.3，与状态机一致）。 */
export type ViewState =
  | 'creating'
  | 'loading'
  | 'ready'
  | 'contentDelivered'
  | 'reloading'
  | 'error'
  | 'destroyed';

export type TabType = 'document' | 'plugin' | 'browser';

export interface TabEntry {
  /** 稳定键（跨重启持久化用；规则见 architecture.md §5.1）。 */
  tabKey: string;
  /** 运行时句柄（视图宿主的 instanceId）。 */
  instanceId: string;
  type: TabType;
  /** 渲染器 / 内置视图 id（def 匹配、声明式动作）。 */
  extensionId: string;
  title: string;
  /** 地址栏地址（分层：本地相对路径 / app:// scheme）。 */
  url: string;
  state: ViewState;
  /** 编辑器未保存（tab 琥珀点）。 */
  dirty: boolean;
  /** 固定：稳定排在未固定之前，批量关闭跳过。 */
  pinned: boolean;
  /** raw 网页且不在归档名单（临时网页，随标签存亡）。 */
  temporary?: boolean;
  /** type=document 的上下文。 */
  document?: DocumentMeta;
  /** type=plugin 的上下文。 */
  plugin?: PluginInfo;
  /** raw 网页视图标记。 */
  raw?: boolean;
  /** raw 可交互元素（ref 标记 + overlay）是否上屏。 */
  interactiveElements?: boolean;
  /** 声明式动作状态（如 html-editor 的 layout-switch）。 */
  layout?: string;
}

/** 固定组在前，两组内部各自保持数组顺序（稳定排序）。 */
function ordered(list: TabEntry[]): TabEntry[] {
  return [...list.filter((t) => t.pinned), ...list.filter((t) => !t.pinned)];
}

interface TabsStore {
  tabs: TabEntry[];
  activeId: string | null;

  /** 同 tabKey 复用并激活；否则追加（未固定区末尾）并激活。 */
  openOrActivate: (entry: TabEntry) => void;
  /** 激活（不改变顺序）。 */
  activate: (instanceId: string) => void;
  /** 关闭单个 tab，返回下一个激活 id（若无剩余为 null）。 */
  close: (instanceId: string) => string | null;
  /** 关闭一组 tab（外部销毁对齐也走这里，不再触发视图销毁）。 */
  closeMany: (ids: string[]) => string | null;
  /** 关闭其他（保留锚点与固定项），返回下一个激活 id。 */
  closeOthers: (anchorId: string) => string | null;
  /** 关闭左侧（跳过固定项）。 */
  closeToLeft: (anchorId: string) => string | null;
  /** 关闭右侧（跳过固定项）。 */
  closeToRight: (anchorId: string) => string | null;
  /** 关闭全部未固定 tab。 */
  closeAll: () => string | null;
  /** 固定 / 取消固定（重排到对应分组）。 */
  togglePin: (instanceId: string) => void;
  /** 拖拽排序（仅同组内换位；跨组需先 togglePin）。 */
  moveTab: (fromId: string, toId: string) => void;
  /** 生命周期状态投影（宿主 FSM 唯一出口）。 */
  setState: (instanceId: string, state: ViewState) => void;
  /** 脏态（action:dirty 事件驱动）。 */
  setDirty: (instanceId: string, dirty: boolean) => void;
  /** 标题 / 地址 / 上下文等增量更新（导航、标题事件、动作回报）。 */
  patch: (
    instanceId: string,
    partial: Partial<Omit<TabEntry, 'tabKey' | 'instanceId'>>,
  ) => void;
  /** 全量对齐宿主事实（重启恢复 / 外部批量变化）。 */
  syncFromHost: (entries: TabEntry[]) => void;
}

/** 计算关闭集合后的下一个激活：右邻优先 → 左邻 → null。 */
function nextActiveAfterClose(
  list: TabEntry[],
  activeId: string | null,
  removed: Set<string>,
): string | null {
  if (!activeId || !removed.has(activeId)) return activeId;
  const idx = list.findIndex((t) => t.instanceId === activeId);
  if (idx < 0)
    return list.find((t) => !removed.has(t.instanceId))?.instanceId ?? null;
  for (let i = idx + 1; i < list.length; i += 1) {
    if (!removed.has(list[i].instanceId)) return list[i].instanceId;
  }
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (!removed.has(list[i].instanceId)) return list[i].instanceId;
  }
  return null;
}

export const useTabsStore = create<TabsStore>()((set, get) => {
  /** 统一关闭路径：从集合移除 ids，按规则重选激活。 */
  const removeTabs = (ids: string[]): string | null => {
    if (ids.length === 0) return get().activeId;
    const removed = new Set(ids);
    const list = get().tabs;
    const nextActive = nextActiveAfterClose(list, get().activeId, removed);
    set({
      tabs: list.filter((t) => !removed.has(t.instanceId)),
      activeId: nextActive,
    });
    return nextActive;
  };

  return {
    tabs: [],
    activeId: null,

    openOrActivate: (entry) => {
      const list = get().tabs;
      const existing = list.find((t) => t.tabKey === entry.tabKey);
      if (existing) {
        // 复用：宿主可能换了 instanceId（重建），保留 pin/dirty，刷新其余字段
        const updated: TabEntry = {
          ...existing,
          ...entry,
          pinned: existing.pinned,
          dirty: existing.dirty,
        };
        set({
          tabs: list.map((t) => (t.tabKey === entry.tabKey ? updated : t)),
          activeId: updated.instanceId,
        });
        return;
      }
      set({ tabs: ordered([...list, entry]), activeId: entry.instanceId });
    },

    activate: (instanceId) => {
      if (!get().tabs.some((t) => t.instanceId === instanceId)) return;
      set({ activeId: instanceId });
    },

    close: (instanceId) => removeTabs([instanceId]),

    closeMany: (ids) => removeTabs(ids),

    closeOthers: (anchorId) => {
      const ids = get()
        .tabs.filter((t) => t.instanceId !== anchorId && !t.pinned)
        .map((t) => t.instanceId);
      const next = removeTabs(ids);
      // 锚点仍在时保持激活
      if (get().tabs.some((t) => t.instanceId === anchorId))
        set({ activeId: anchorId });
      return next;
    },

    closeToLeft: (anchorId) => {
      const list = get().tabs;
      const idx = list.findIndex((t) => t.instanceId === anchorId);
      if (idx <= 0) return get().activeId;
      const ids = list
        .slice(0, idx)
        .filter((t) => !t.pinned)
        .map((t) => t.instanceId);
      const next = removeTabs(ids);
      if (
        get().tabs.some((t) => t.instanceId === anchorId) &&
        get().activeId !== anchorId
      ) {
        // 激活项被关掉时，锚点接管
        if (!get().tabs.some((t) => t.instanceId === get().activeId))
          set({ activeId: anchorId });
      }
      return get().activeId ?? next;
    },

    closeToRight: (anchorId) => {
      const list = get().tabs;
      const idx = list.findIndex((t) => t.instanceId === anchorId);
      if (idx < 0 || idx === list.length - 1) return get().activeId;
      const ids = list
        .slice(idx + 1)
        .filter((t) => !t.pinned)
        .map((t) => t.instanceId);
      const next = removeTabs(ids);
      if (
        get().tabs.some((t) => t.instanceId === anchorId) &&
        !get().tabs.some((t) => t.instanceId === get().activeId)
      ) {
        set({ activeId: anchorId });
      }
      return get().activeId ?? next;
    },

    closeAll: () => {
      const ids = get()
        .tabs.filter((t) => !t.pinned)
        .map((t) => t.instanceId);
      return removeTabs(ids);
    },

    togglePin: (instanceId) => {
      const list = get().tabs;
      const tab = list.find((t) => t.instanceId === instanceId);
      if (!tab) return;
      const rest = list.filter((t) => t.instanceId !== instanceId);
      const pinnedCount = rest.filter((t) => t.pinned).length;
      const updated: TabEntry = { ...tab, pinned: !tab.pinned };
      // 固定 → 追加到固定组末尾；取消固定 → 插到未固定组首位
      const insertAt = updated.pinned ? pinnedCount : pinnedCount;
      const next = [
        ...rest.slice(0, insertAt),
        updated,
        ...rest.slice(insertAt),
      ];
      set({ tabs: ordered(next) });
    },

    moveTab: (fromId, toId) => {
      const list = get().tabs;
      const from = list.find((t) => t.instanceId === fromId);
      const to = list.find((t) => t.instanceId === toId);
      if (
        !from ||
        !to ||
        from.instanceId === to.instanceId ||
        from.pinned !== to.pinned
      )
        return;
      const rest = list.filter((t) => t.instanceId !== fromId);
      const at = rest.findIndex((t) => t.instanceId === toId);
      const next = [...rest.slice(0, at), from, ...rest.slice(at)];
      set({ tabs: ordered(next) });
    },

    setState: (instanceId, state) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.instanceId === instanceId ? { ...t, state } : t,
        ),
      }));
    },

    setDirty: (instanceId, dirty) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.instanceId === instanceId ? { ...t, dirty } : t,
        ),
      }));
    },

    patch: (instanceId, partial) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.instanceId === instanceId ? { ...t, ...partial } : t,
        ),
      }));
    },

    syncFromHost: (entries) => {
      const prev = get().tabs;
      const byInstance = new Map(prev.map((t) => [t.instanceId, t]));
      // 宿主事实为准；保留渲染层拥有的 UI 态（pinned/dirty/document/plugin 上下文）
      const merged = entries.map((e) => {
        const old = byInstance.get(e.instanceId);
        return old
          ? {
              ...old,
              ...e,
              pinned: old.pinned,
              dirty: old.dirty,
              document: e.document ?? old.document,
              plugin: e.plugin ?? old.plugin,
            }
          : e;
      });
      const active = get().activeId;
      set({
        tabs: ordered(merged),
        activeId:
          active && merged.some((t) => t.instanceId === active)
            ? active
            : (merged[merged.length - 1]?.instanceId ?? null),
      });
    },
  };
});

// ─── 派生选择器（消费方共用，避免各自过滤） ───────────────

/** 打开的文档集合（侧边栏文档分组展开项）。 */
export function openDocsOf(tabs: TabEntry[]): DocumentMeta[] {
  const seen = new Map<string, DocumentMeta>();
  for (const tab of tabs) {
    if (tab.type === 'document' && tab.document)
      seen.set(tab.document.id, tab.document);
  }
  return [...seen.values()];
}

/** 激活 tab 绑定的文档 id（侧边栏「当前」高亮真相源）。 */
export function activeDocIdOf(
  tabs: TabEntry[],
  activeId: string | null,
): string | null {
  if (!activeId) return null;
  return tabs.find((t) => t.instanceId === activeId)?.document?.id ?? null;
}

/** 临时网页标签（侧边栏「临时网页」分组 / 二级列表）。 */
export function tempTabsOf(tabs: TabEntry[]): TabEntry[] {
  return tabs.filter((t) => t.type === 'browser' && t.temporary);
}

/** 激活 tab。 */
export function activeTabOf(
  tabs: TabEntry[],
  activeId: string | null,
): TabEntry | null {
  if (!activeId) return null;
  return tabs.find((t) => t.instanceId === activeId) ?? null;
}
