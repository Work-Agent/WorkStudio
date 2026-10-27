/**
 * 用户操作状态 store（zustand）—— 主进程 UiStateService 的渲染层镜像。
 *
 * 架构：
 *   - 真相源 = 主进程 ui-state.json（按工作区隔离，原子写 + 防抖批量落盘）
 *   - 渲染层 = zustand 镜像：set() 乐观更新 → IPC 直通 → 广播收敛
 *   - 订阅源 = ui-state:changed 广播
 */
import { create } from 'zustand';
import type { UiState } from '../../shared/types';

/** 主进程桥：UI 状态以主进程为唯一真相源。 */
const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

const DEFAULTS: UiState = {
  __version__: 1,
  theme: 'dark',
  aiOpen: true,
  aiFloating: false,
  sidebarView: 'main',
  sidebarDomain: null,
  sidebarCollapsed: false,
  panelCollapsed: false,
  inputExpanded: false,
  selectedSkills: [],
  paneWidths: { left: 240, right: 420 },
  activePath: null,
  openPaths: [],
};

type UiPatch = Partial<Omit<UiState, '__version__'>>;

interface UiStoreState extends UiState {
  hydrated: boolean;
  init: () => Promise<void>;
  patch: (patch: UiPatch) => void;
  toggleTheme: () => void;
  openSessionTab: (path: string) => void;
  closeSessionTab: (path: string) => void;
  removeSessionFromTabs: (path: string, nextActive: string | null) => void;
}

export const useUiStore = create<UiStoreState>()((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  init: async () => {
    if (get().hydrated) return;
    set({ hydrated: true });
  },

  patch: (patch) => {
    set(patch as Partial<UiStoreState>);
    void mainBridge?.cmd('ui.set', { patch });
  },

  toggleTheme: () =>
    get().patch({ theme: get().theme === 'dark' ? 'light' : 'dark' }),

  /** 会话标签打开语义：加入 openPaths（若未在）+ 激活。 */
  openSessionTab: (path) => {
    void mainBridge?.cmd('session.openTab', { path });
  },

  /** 关闭标签 ≠ 删除：openPaths 移除；关的是活跃则切相邻，无剩余回新任务态。 */
  closeSessionTab: (path) => {
    void mainBridge?.cmd('session.closeTabs', { paths: [path] });
  },

  /** 删除会话时同步清理 openPaths / activePath（真删除路径，配合会话 store）。 */
  removeSessionFromTabs: (path, nextActive) => {
    set((state) => ({
      openPaths: state.openPaths.filter((p) => p !== path),
      activePath: nextActive,
    }));
  },
}));

/** 写：乐观更新 + IPC 直通（主进程合并落盘并广播回收敛）。 */
export function setUiState(patch: UiPatch): void {
  useUiStore.getState().patch(patch);
}

/** 主题切换。 */
export function toggleTheme(): void {
  useUiStore.getState().toggleTheme();
}
