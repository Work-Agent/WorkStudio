/**
 * layout：窗口尺寸 + NativeScene (+ 交互预览) → 原生视图矩形。
 *
 * 与工作台共用 `shared/layout-engine`：DOM 条带与原生视图必须由同一份
 * 常量与夹取规则算出。interaction 只是 layout 的 preview 状态，不单独设 controller。
 */

import type { LayoutSnapshot, NativeScene } from '../../runtime/shared.ts';
import {
  clampFloating,
  commitPaneResize,
  computeLayout as computeSharedLayout,
  defaultFloating,
  previewPaneResize,
} from '../../../shared/layout-engine.ts';
import type {
  InteractionPreview,
  InteractionType,
  Rect,
  ResizeDirection,
  UiState,
} from '../../../shared/types.ts';

export interface InteractionInput {
  type: InteractionType;
  side?: 'left' | 'right';
  target?: string;
  direction?: ResizeDirection;
  /** 发起视图内的指针坐标；用于分栏拖拽，避免依赖屏幕光标。 */
  pointerX?: number;
  pointerY?: number;
}

export interface InteractionSession {
  input: InteractionInput;
  scene: NativeScene;
  cursor: { x: number; y: number };
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function uiOf(scene: NativeScene): UiState {
  const paneWidths = (scene['paneWidths'] ?? {}) as {
    left?: unknown;
    right?: unknown;
  };
  return {
    sidebarCollapsed: scene['sidebarCollapsed'] === true,
    aiOpen: scene['aiOpen'] !== false,
    aiFloating: scene['aiFloating'] === true,
    paneWidths: {
      left: number(paneWidths.left, 240),
      right: number(paneWidths.right, 420),
    },
  } as UiState;
}

function floatingOf(scene: NativeScene): Rect | null {
  return (scene['floating'] as Rect | null | undefined) ?? null;
}

export function computeLayout(
  size: { width: number; height: number },
  scene: NativeScene,
  preview: InteractionPreview | null = null,
): LayoutSnapshot {
  const layout = computeSharedLayout({
    windowWidth: size.width,
    windowHeight: size.height,
    ui: uiOf(scene),
    floating: floatingOf(scene),
    preview,
  });
  return { ...layout, capture: layout.overlay };
}

/** 交互开始：冻结起始 scene + 屏幕光标；后续只产 preview，不写 scene。 */
export function beginInteraction(
  scene: NativeScene,
  input: InteractionInput,
  cursor: { x: number; y: number },
): InteractionSession {
  return { input, scene, cursor };
}

/** 交互中的几何预览；pane / floating 都复用共享布局引擎的夹取规则。 */
export function previewInteraction(
  session: InteractionSession,
  cursor: { x: number; y: number },
  size: { width: number; height: number },
): InteractionPreview | null {
  const { input } = session;
  const dx = cursor.x - session.cursor.x;
  const dy = cursor.y - session.cursor.y;

  if (input.type === 'pane-resize') {
    const side = input.side ?? (input.target === 'right' ? 'right' : 'left');
    return previewPaneResize(
      side,
      session.cursor.x,
      cursor.x,
      uiOf(session.scene),
      size.width,
    );
  }

  if (input.type === 'view-move' || input.type === 'view-resize') {
    const base = computeLayout(size, session.scene);
    const start =
      floatingOf(session.scene) ?? defaultFloating(base.resourcePane);
    if (input.type === 'view-move') {
      return {
        type: 'view-move',
        floating: clampFloating(
          { ...start, x: start.x + dx, y: start.y + dy },
          base.resourcePane,
        ),
      };
    }
    const direction = input.direction ?? 'se';
    const box = {
      x: start.x + (direction.includes('w') ? dx : 0),
      y: start.y + (direction.includes('n') ? dy : 0),
      width:
        start.width +
        (direction.includes('e') ? dx : 0) -
        (direction.includes('w') ? dx : 0),
      height:
        start.height +
        (direction.includes('s') ? dy : 0) -
        (direction.includes('n') ? dy : 0),
    };
    return {
      type: 'view-resize',
      floating: clampFloating(box, base.resourcePane),
    };
  }

  return null;
}

/** 交互结束：把 preview 收敛成 scene patch；layout 的持久状态仍只有 scene。 */
export function commitInteraction(
  preview: InteractionPreview,
  scene: NativeScene,
  windowWidth: number,
): Partial<NativeScene> {
  if (preview.type === 'pane-resize') {
    const patch = commitPaneResize(preview, uiOf(scene), windowWidth);
    return {
      ...(patch.sidebarCollapsed !== undefined
        ? { sidebarCollapsed: patch.sidebarCollapsed }
        : {}),
      ...(patch.paneWidths ? { paneWidths: patch.paneWidths } : {}),
    };
  }
  if (preview.type === 'view-move' || preview.type === 'view-resize') {
    return { floating: preview.floating ?? null };
  }
  return {};
}
