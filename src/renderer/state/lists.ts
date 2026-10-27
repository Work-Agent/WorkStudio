/**
 * 列表快照投影（Phase 4）。
 *
 * 主进程 lists.snapshot 是唯一数据源；资源 / 视图变更时去抖刷新。
 */

import { create } from 'zustand';
import type { ListGroup, ListSnapshot } from '../../shared/lists';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface ListsState {
  groups: ListGroup[];
  loading: boolean;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
}

let initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export const useListsStore = create<ListsState>()((set, get) => ({
  groups: [],
  loading: false,

  init: async () => {
    if (initialized) return;
    initialized = true;
    await get().refresh();
    if (!mainBridge) return;
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().refresh(), 150);
    };
    mainBridge.onResources(schedule);
    mainBridge.onViews(schedule);
    mainBridge.onUra(schedule);
  },

  refresh: async () => {
    if (!mainBridge) return;
    set({ loading: true });
    try {
      const response = await mainBridge.cmd<ListSnapshot>('lists.snapshot');
      if (response.ok) set({ groups: response.data.groups });
    } finally {
      set({ loading: false });
    }
  },
}));
