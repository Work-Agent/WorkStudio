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

export const useListsStore = create<ListsState>()((set, get) => ({
  groups: [],
  loading: false,

  init: async () => {
    if (initialized) return;
    initialized = true;
    if (mainBridge) {
      // 由 appScope 的 AppSnapshot 水合；不再单独拉 lists.snapshot。
      return;
    }
    await get().refresh();
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
