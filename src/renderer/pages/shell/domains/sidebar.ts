import { create } from 'zustand';

export type SidebarView = 'main' | 'plugins' | 'settings' | 'search';

/** 搜索面板内部的两种检索：文件名 / 文件内容。 */
export type SearchMode = 'files' | 'content';

interface SidebarState {
  view: SidebarView;
  searchMode: SearchMode;
  group: string | null;
  setView: (view: SidebarView) => void;
  setSearchMode: (mode: SearchMode) => void;
  setGroup: (group: string | null) => void;
}

/** 侧栏自身的瞬时状态；不写主进程、不进入任何全局数据层。 */
export const useSidebarStore = create<SidebarState>()((set) => ({
  view: 'main',
  searchMode: 'files',
  group: null,
  setView: (view) => set({ view }),
  setSearchMode: (searchMode) => set({ searchMode }),
  setGroup: (group) => set({ group }),
}));
