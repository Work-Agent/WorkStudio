/**
 * 布局域 store（zustand）—— 三栏拖拽布局的运行时状态与拖拽数学。
 *
 * 真相分层：
 *   - 持久档：uiState.paneWidths（真相源 = 主进程 ui-state.json，重启恢复）
 *   - 运行时：本 store 的拖拽会话（side/起点/容器宽）+ 预览偏离
 *
 * 单值设计（回声竞态的结构解）：
 *   非拖拽时 leftWidth() = uiState.paneWidths.left（零副本、零同步）；
 *   拖拽期间 = 夹取后的预览值（preview 仅拖拽期间非空，松手提交后清空）。
 */
import { create } from 'zustand';
import { setUiState, useUiStore } from './uiState';

// ─── 布局常量（SplitView 渲染与本域共用） ────────────────────

/** 左栏收起（图标列）固定宽度：容纳真实行布局（列表体 px-1 + 分组行 px-2 + 图标 32px）。 */
export const LEFT_COLLAPSED_PX = 56;
/** 拖拽左栏到该宽度以下松手 → 自动收起。 */
export const COLLAPSE_THRESHOLD_PX = 140;
/** 左栏拖拽下限（允许拖入收起阈值区）。 */
export const MIN_DRAG_PX = 48;
/** 收起后重置的展开默认宽度（展开恢复用）。 */
export const DEFAULT_LEFT_PX = 240;

type DragSide = 'left' | 'right';

interface DragSession {
  side: DragSide;
  startClientX: number;
  startLeft: number;
  startRight: number;
  containerWidth: number;
  /** 从收起态开始拖拽：首次 move 即展开。 */
  fromCollapsed: boolean;
}

interface LayoutState {
  dragging: DragSide | null;
  preview: { left: number; right: number } | null;
  beginDrag: (
    side: DragSide,
    startClientX: number,
    containerWidth: number,
    leftCollapsed: boolean,
  ) => void;
  moveDrag: (clientX: number) => void;
  endDrag: () => void;
}

let session: DragSession | null = null;

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const useLayoutStore = create<LayoutState>()((set) => ({
  dragging: null,
  preview: null,

  /** 开始拖拽（mousedown）：记录会话；收起态起点 = 收起宽（预览连续不跳变）。 */
  beginDrag: (side, startClientX, containerWidth, leftCollapsed) => {
    const paneWidths = useUiStore.getState().paneWidths;
    session = {
      side,
      startClientX,
      startLeft: leftCollapsed ? LEFT_COLLAPSED_PX : paneWidths.left,
      startRight: paneWidths.right,
      containerWidth,
      fromCollapsed: leftCollapsed,
    };
    set({
      dragging: side,
      preview: leftCollapsed
        ? { left: LEFT_COLLAPSED_PX, right: paneWidths.right }
        : null,
    });
  },

  /** 拖拽移动（mousemove）：夹取数学更新预览（不写 uiState——松手才提交）。 */
  moveDrag: (clientX) => {
    const s = session;
    if (!s) return;
    const dx = clientX - s.startClientX;
    if (s.fromCollapsed) {
      s.fromCollapsed = false;
      setUiState({ sidebarCollapsed: false }); // 拖拽即展开
    }
    if (s.side === 'left') {
      const next = clamp(s.startLeft + dx, MIN_DRAG_PX, s.containerWidth * 0.3);
      set((state) => ({
        preview: { left: next, right: state.preview?.right ?? s.startRight },
      }));
    } else {
      const next = clamp(
        s.startRight - dx,
        s.containerWidth * 0.25,
        s.containerWidth * 0.5,
      );
      set((state) => ({
        preview: { left: state.preview?.left ?? s.startLeft, right: next },
      }));
    }
  },

  /** 结束拖拽（mouseup）：收起判定 / 夹回合法范围 / 一次提交 paneWidths + 清预览。 */
  endDrag: () => {
    const s = session;
    const p = useLayoutStore.getState().preview;
    session = null;
    set({ dragging: null, preview: null });
    if (!s || !p) return;
    const paneWidths = useUiStore.getState().paneWidths;

    if (s.side === 'left') {
      if (p.left < COLLAPSE_THRESHOLD_PX) {
        setUiState({
          sidebarCollapsed: true,
          paneWidths: { left: DEFAULT_LEFT_PX, right: paneWidths.right },
        });
        return;
      }
      const left = Math.round(
        clamp(p.left, s.containerWidth * 0.15, s.containerWidth * 0.3),
      );
      setUiState({
        sidebarCollapsed: false,
        paneWidths: { left, right: paneWidths.right },
      });
    } else {
      setUiState({
        paneWidths: { left: paneWidths.left, right: Math.round(p.right) },
      });
    }
  },
}));

/** 左栏当前宽（拖拽预览 > 持久值；收起态渲染由 SplitView 按 leftCollapsed 分支）。 */
export const layoutLeftWidth = (): number =>
  useLayoutStore.getState().preview?.left ??
  useUiStore.getState().paneWidths.left;

/** 右栏当前宽（同上）。 */
export const layoutRightWidth = (): number =>
  useLayoutStore.getState().preview?.right ??
  useUiStore.getState().paneWidths.right;
