/**
 * 布局引擎（architecture.md §14.1）—— bounds 唯一真相源，纯函数无副作用。
 *
 * 输入：窗口尺寸 + UiState + 浮动几何 + 交互预览；
 * 输出：全部 DOM 条带与原生视图共用的 Rect（渲染层从 ws:state 读同一份）。
 */
import type {
  InteractionPreview,
  LayoutSnapshot,
  Rect,
  UiState,
} from './types';
import {
  ASSISTANT_DEFAULT_H,
  ASSISTANT_DEFAULT_W,
  ASSISTANT_MARGIN,
  ASSISTANT_MIN_H,
  ASSISTANT_MIN_W,
  COLLAPSE_THRESHOLD_PX,
  DEFAULT_LEFT_PX,
  LEFT_COLLAPSED_PX,
  LEFT_MAX_RATIO,
  LEFT_MIN_RATIO,
  RIGHT_MAX_RATIO,
  RIGHT_MIN_RATIO,
  SPLITTER_GAP,
  TABBAR_HEIGHT,
  TITLEBAR_HEIGHT,
} from './layout';

export interface LayoutInput {
  windowWidth: number;
  windowHeight: number;
  ui: UiState;
  /** 运行期浮动几何（null = 默认位置）。 */
  floating: Rect | null;
  /** 交互预览（拖拽期间覆盖持久值）。 */
  preview: InteractionPreview | null;
  /** 页面视口（渲染层上报；docked DevTools 时小于窗口 → 原生视图让位）。 */
  viewport?: { width: number; height: number } | null;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

export function computeLayout(input: LayoutInput): LayoutSnapshot {
  const rawW = Math.max(0, Math.round(input.windowWidth));
  const rawH = Math.max(0, Math.round(input.windowHeight));
  // 页面视口可能小于窗口（docked DevTools）：原生视图只能占用页面区域。
  const w = input.viewport
    ? Math.min(rawW, Math.max(0, Math.round(input.viewport.width)))
    : rawW;
  const h = input.viewport
    ? Math.min(rawH, Math.max(0, Math.round(input.viewport.height)))
    : rawH;
  const ui = input.ui;
  const preview = input.preview;

  const collapsed = preview?.sidebarCollapsed ?? ui.sidebarCollapsed;
  const leftTarget = preview?.paneWidths?.left ?? ui.paneWidths.left;
  const rightTarget = preview?.paneWidths?.right ?? ui.paneWidths.right;

  const leftWidth = collapsed
    ? LEFT_COLLAPSED_PX
    : Math.round(clamp(leftTarget, w * LEFT_MIN_RATIO, w * LEFT_MAX_RATIO));
  const rightDockWidth =
    ui.aiOpen && !ui.aiFloating
      ? Math.round(clamp(rightTarget, w * RIGHT_MIN_RATIO, w * RIGHT_MAX_RATIO))
      : 0;

  const workbench: Rect = {
    x: 0,
    y: TITLEBAR_HEIGHT,
    width: w,
    height: Math.max(0, h - TITLEBAR_HEIGHT),
  };
  const sidebar: Rect = {
    x: 0,
    y: workbench.y,
    width: leftWidth,
    height: workbench.height,
  };
  // 分隔条让位：原生视图在 DOM 之上，左右各留 SPLITTER_GAP 给 DOM 把手（右侧仅停靠时留）。
  const rightGap = rightDockWidth > 0 ? SPLITTER_GAP : 0;
  const resourcePane: Rect = {
    x: leftWidth + SPLITTER_GAP,
    y: workbench.y,
    width: Math.max(
      0,
      workbench.width - leftWidth - rightDockWidth - SPLITTER_GAP - rightGap,
    ),
    height: workbench.height,
  };
  const tabbar: Rect = {
    x: resourcePane.x,
    y: resourcePane.y,
    width: resourcePane.width,
    height: TABBAR_HEIGHT,
  };
  const resourceContent: Rect = {
    x: resourcePane.x,
    y: resourcePane.y + TABBAR_HEIGHT,
    width: resourcePane.width,
    height: Math.max(0, resourcePane.height - TABBAR_HEIGHT),
  };
  const assistantDock: Rect = {
    x: workbench.width - rightDockWidth + rightGap,
    y: workbench.y,
    width: Math.max(0, rightDockWidth - rightGap),
    height: workbench.height,
  };
  const floating = preview?.floating ?? input.floating;
  const assistantFloating = clampFloating(
    floating ?? defaultFloating(resourcePane),
    resourcePane,
  );

  return {
    window: { width: w, height: h },
    titlebar: { x: 0, y: 0, width: w, height: TITLEBAR_HEIGHT },
    workbench,
    sidebar,
    resourcePane,
    tabbar,
    resourceContent,
    assistantDock,
    assistantFloating,
    overlay: workbench,
  };
}

/** 浮动助手：夹取在资源面板内（z-order 规则：不得盖住 DOM 区域）。 */
export function clampFloating(rect: Rect, pane: Rect): Rect {
  const availW = Math.max(200, pane.width - ASSISTANT_MARGIN * 2);
  const availH = Math.max(200, pane.height - ASSISTANT_MARGIN * 2);
  const width = Math.min(
    Math.max(rect.width, Math.min(ASSISTANT_MIN_W, availW)),
    Math.max(200, pane.width),
  );
  const height = Math.min(
    Math.max(rect.height, Math.min(ASSISTANT_MIN_H, availH)),
    Math.max(200, pane.height),
  );
  const x = clamp(
    rect.x,
    pane.x + ASSISTANT_MARGIN,
    pane.x + pane.width - width - ASSISTANT_MARGIN,
  );
  const y = clamp(
    rect.y,
    pane.y + ASSISTANT_MARGIN,
    pane.y + pane.height - height - ASSISTANT_MARGIN,
  );
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** 默认浮动位置：资源面板右下角。 */
export function defaultFloating(pane: Rect): Rect {
  const width = Math.min(
    ASSISTANT_DEFAULT_W,
    Math.max(ASSISTANT_MIN_W, pane.width - ASSISTANT_MARGIN * 2),
  );
  const height = Math.min(
    ASSISTANT_DEFAULT_H,
    Math.max(ASSISTANT_MIN_H, pane.height - ASSISTANT_MARGIN * 2),
  );
  return {
    x: pane.x + pane.width - width - ASSISTANT_MARGIN,
    y: pane.y + pane.height - height - ASSISTANT_MARGIN,
    width,
    height,
  };
}

/** 分栏拖拽：计算预览宽度（左栏 <阈值 → 收起预览）。 */
export function previewPaneResize(
  side: 'left' | 'right',
  startClientX: number,
  cursorX: number,
  ui: UiState,
  windowWidth: number,
): InteractionPreview {
  const dx = cursorX - startClientX;
  if (side === 'left') {
    const raw = ui.sidebarCollapsed ? LEFT_COLLAPSED_PX : ui.paneWidths.left;
    const next = clamp(raw + dx, 0, windowWidth * LEFT_MAX_RATIO);
    return {
      type: 'pane-resize',
      side: 'left',
      paneWidths: { left: Math.round(next), right: ui.paneWidths.right },
      sidebarCollapsed: next < COLLAPSE_THRESHOLD_PX,
    };
  }
  const next = clamp(
    ui.paneWidths.right - dx,
    windowWidth * RIGHT_MIN_RATIO,
    windowWidth * RIGHT_MAX_RATIO,
  );
  return {
    type: 'pane-resize',
    side: 'right',
    paneWidths: { left: ui.paneWidths.left, right: Math.round(next) },
    sidebarCollapsed: ui.sidebarCollapsed,
  };
}

/** 左栏拖拽松手提交：收起判定 + 夹回合法范围。 */
export function commitPaneResize(
  preview: InteractionPreview,
  ui: UiState,
  windowWidth: number,
): Partial<UiState> {
  if (preview.type !== 'pane-resize') return {};
  const widths = preview.paneWidths ?? ui.paneWidths;
  if (preview.side === 'right') {
    return {
      paneWidths: { left: ui.paneWidths.left, right: Math.round(widths.right) },
    };
  }
  if (preview.sidebarCollapsed) {
    return {
      sidebarCollapsed: true,
      paneWidths: { left: DEFAULT_LEFT_PX, right: ui.paneWidths.right },
    };
  }
  return {
    sidebarCollapsed: false,
    paneWidths: {
      left: Math.round(
        clamp(
          widths.left,
          windowWidth * LEFT_MIN_RATIO,
          windowWidth * LEFT_MAX_RATIO,
        ),
      ),
      right: ui.paneWidths.right,
    },
  };
}
