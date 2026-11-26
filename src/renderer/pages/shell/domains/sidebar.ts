import { create } from 'zustand';

export type SidebarView = 'main' | 'plugins' | 'settings' | 'find' | 'grep';

interface SidebarState {
  view: SidebarView;
  group: string | null;
  setView: (view: SidebarView) => void;
  setGroup: (group: string | null) => void;
}

/** 侧栏自身的瞬时状态；不写主进程、不进入任何全局数据层。 */
export const useSidebarStore = create<SidebarState>()((set) => ({
  view: 'main',
  group: null,
  setView: (view) => set({ view }),
  setGroup: (group) => set({ group }),
}));
