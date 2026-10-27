/** 让位带两侧表面色（与各栏表面同源，避免“单色画布”在两侧不同色时露出缝）。 */
const SIDEBAR_SURFACE = 'bg-zinc-50 dark:bg-[#1A1C1D]';
const CONTENT_SURFACE = 'bg-zinc-100 dark:bg-[#1a1c1d]';
const ASSISTANT_SURFACE = 'bg-zinc-50 dark:bg-[#202124]';

/**
 * 停靠分隔条把手（DOM）—— architecture.md §5.1.4 / §5.1.5。
 *
 * 位置完全来自主进程 layout 矩形（两侧原生视图按 SPLITTER_GAP 让位），本组件不测量容器、
 * 不计算栏宽：按下 → `interaction.begin`，移动 → `interaction.move`（主进程算几何并经
 * app:snapshot 广播预览），松手 → `interaction.end`（主进程提交 paneWidths）。
 *
 * 让位带两侧各取邻栏表面色（中点分开）+ 居中 1px 线：等价于「分隔条压在栏交界上」，
 * 两侧表面各自连续，只剩一条边界线。
 */
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LayoutSnapshot } from '../../shared/types';
import { TABBAR_HEIGHT } from '../../shared/layout';
import { useShellStore } from '../state/shell';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

/** 把手矩形 = 两侧区域之间的让位带（无让位 = 不渲染）。 */
function bandRect(
  side: 'left' | 'right',
  layout: LayoutSnapshot,
): { x: number; width: number } | null {
  const { sidebar, resourcePane, assistantDock } = layout;
  if (side === 'left') {
    const x = sidebar.x + sidebar.width;
    return { x, width: resourcePane.x - x };
  }
  const x = resourcePane.x + resourcePane.width;
  return { x, width: assistantDock.x - x };
}

export function PaneSplitter({ side }: { side: 'left' | 'right' }) {
  const layout = useShellStore((s) => s.layout);
  const [active, setActive] = useState(false);
  if (!layout) return null;
  const band = bandRect(side, layout);
  if (!band || band.width <= 0) return null;
  const { workbench } = layout;
  const [leftSurface, rightSurface] =
    side === 'left'
      ? [SIDEBAR_SURFACE, CONTENT_SURFACE]
      : [CONTENT_SURFACE, ASSISTANT_SURFACE];

  return (
    <div
      data-splitter={side}
      role="separator"
      aria-orientation="vertical"
      className="absolute z-20 cursor-col-resize group"
      style={{
        left: band.x,
        top: workbench.y,
        width: band.width,
        height: workbench.height,
        touchAction: 'none',
      }}
      onMouseDown={(e) => beginPaneDrag(side, e, setActive)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {/* 让位带：左半跟左栏、右半跟右栏（表面各自连续，无单色痕） */}
      <div className={`absolute inset-y-0 left-0 w-1/2 ${leftSurface}`} />
      <div className={`absolute inset-y-0 right-0 w-1/2 ${rightSurface}`} />
      {/* 顶部横向补缝：与 TabsBar / SidebarNav / 助手 tabs 的下边框同一条线（让位带不留断线） */}
      <div
        className="absolute left-0 right-0 h-px bg-zinc-200 dark:bg-zinc-800 pointer-events-none"
        style={{ top: TABBAR_HEIGHT - 1 }}
      />
      {/* 视觉线体：1px 常显分隔线（= 边界），hover / 拖拽时变靛蓝（ui-design §十二） */}
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${
          active ? 'bg-[#4F6BED]' : 'bg-zinc-300 dark:bg-zinc-800'
        }`}
      />
    </div>
  );
}

/** 拖拽序列由把手（发起方）持有：主进程只消费 begin/move/end 三个信号。 */
function beginPaneDrag(
  side: 'left' | 'right',
  e: ReactMouseEvent<HTMLDivElement>,
  setActive: (active: boolean) => void,
): void {
  e.preventDefault();
  if (!mainBridge) return;
  setActive(true);
  void mainBridge.interaction.begin({
    type: 'pane-resize',
    target: side,
    anchor: { x: e.clientX, y: e.clientY },
  });
  const onMove = (): void => {
    void mainBridge.interaction.move();
  };
  const onUp = (): void => {
    void mainBridge.interaction.end();
    cleanup();
  };
  const cleanup = (): void => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setActive(false);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}
