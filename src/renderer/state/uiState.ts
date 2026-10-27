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
import { agentAPI } from '../api/bridge';

/** 主进程桥（新架构）；存在时 UI 状态以主进程为唯一真相源（禁用 mock 写路径）。 */
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

/** 只取 UiState 字段（IPC 传输不携带 actions）。 */
function snapshot(state: UiStoreState): UiState {
  return {
    __version__: state.__version__,
    theme: state.theme,
    aiOpen: state.aiOpen,
    aiFloating: state.aiFloating,
    sidebarView: state.sidebarView,
    sidebarDomain: state.sidebarDomain,
    sidebarCollapsed: state.sidebarCollapsed,
    panelCollapsed: state.panelCollapsed,
    inputExpanded: state.inputExpanded,
    selectedSkills: [...state.selectedSkills],
    paneWidths: { ...state.paneWidths },
    activePath: state.activePath,
    openPaths: [...state.openPaths],
  };
}

/** 合并远端快照：已移除的旧形态（会话二级列表 / 业务数据分组）归一为主列表。 */
const merge = (remote: UiState): UiState => ({
  ...DEFAULTS,
  ...remote,
  sidebarView:
    remote.sidebarView === 'sessions' || remote.sidebarView === 'data'
      ? 'main'
      : remote.sidebarView,
});

export const useUiStore = create<UiStoreState>()((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  init: async () => {
    if (get().hydrated) return;
    const remote = await agentAPI.uiState.get();
    set({ ...merge(remote), hydrated: true });
    agentAPI.uiState.onChanged((state) => set(merge(state)));
  },

  patch: (patch) => {
    set(patch as Partial<UiStoreState>);
    if (mainBridge) {
      void mainBridge.cmd('ui.set', { patch });
      return;
    }
    const next = { ...snapshot(get()), ...patch };
    void agentAPI.uiState.set({
      ...patch,
      // store 内数组可能来自状态克隆，跨 IPC 前确保是普通数组
      ...(next.openPaths ? { openPaths: [...next.openPaths] } : {}),
      ...(next.selectedSkills
        ? { selectedSkills: [...next.selectedSkills] }
        : {}),
    });
  },

  toggleTheme: () =>
    get().patch({ theme: get().theme === 'dark' ? 'light' : 'dark' }),

  /** 会话标签打开语义：加入 openPaths（若未在）+ 激活。 */
  openSessionTab: (path) => {
    if (mainBridge) {
      void mainBridge.cmd('session.openTab', { path });
      return;
    }
    const { openPaths } = get();
    const next = openPaths.includes(path)
      ? [...openPaths]
      : [...openPaths, path];
    set({ openPaths: next, activePath: path });
    void agentAPI.uiState.set({ openPaths: next, activePath: path });
  },

  /** 关闭标签 ≠ 删除：openPaths 移除；关的是活跃则切相邻，无剩余回新任务态。 */
  closeSessionTab: (path) => {
    if (mainBridge) {
      void mainBridge.cmd('session.closeTabs', { paths: [path] });
      return;
    }
    const { openPaths, activePath } = get();
    const next = openPaths.filter((p) => p !== path);
    let nextActive = activePath;
    if (path === activePath) {
      nextActive =
        next.length > 0
          ? next[Math.min(openPaths.indexOf(path), next.length - 1)]
          : null;
    }
    set({ openPaths: next, activePath: nextActive });
    void agentAPI.uiState.set({ openPaths: next, activePath: nextActive });
  },

  /** 删除会话时同步清理 openPaths / activePath（真删除路径，配合会话 store）。 */
  removeSessionFromTabs: (path, nextActive) => {
    const next = get().openPaths.filter((p) => p !== path);
    set({ openPaths: next, activePath: nextActive });
    void agentAPI.uiState.set({ openPaths: next, activePath: nextActive });
  },
}));

/** 启动 hydrate（main.tsx 调一次，await 后再 mount App）。 */
export async function initUiState(): Promise<void> {
  return useUiStore.getState().init();
}

/** 写：乐观更新 + IPC 直通（主进程合并落盘并广播回收敛）。 */
export function setUiState(patch: UiPatch): void {
  useUiStore.getState().patch(patch);
}

/** 主题切换。 */
export function toggleTheme(): void {
  useUiStore.getState().toggleTheme();
}
