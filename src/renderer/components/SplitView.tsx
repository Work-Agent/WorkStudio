/**
 * 三栏拖拽布局（视图层）—— 状态与拖拽数学在 state/layout.ts（布局域 store）。
 *
 * 本组件只剩：把手 DOM（视觉规范：1px 视觉线 + 11px 命中区）+ 鼠标事件 → store 动作
 * 转译 + 渲染。宽度读取：layout store（拖拽预览 > 持久值）；窗口 resize 后持久值
 * 可能超范围 → 渲染时显示夹取（不回写，瞬态修正）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LEFT_COLLAPSED_PX,
  useLayoutStore,
  layoutLeftWidth,
  layoutRightWidth,
} from '../state/layout';
import { useUiStore } from '../state/uiState';

interface SplitViewProps {
  /** 三栏：左（固定范围）/ 中（弹性）/ 右（可选，收起时 null） */
  left: ReactNode;
  middle: ReactNode;
  right?: ReactNode | null;
  /** 左栏收起：窄图标栏（不可拖拽），否则正常可拖拽宽度。 */
  leftCollapsed?: boolean;
  /** 右栏是否显示（aiOpen=false 时整栏收起）。 */
  showRight?: boolean;
}

/** 拖拽把手：视觉 1px 细线 + 11px 命中区（负 margin 外扩）。 */
function Divider({
  onMouseDown,
  interactive = true,
  hidden = false,
}: {
  onMouseDown?: (e: React.MouseEvent) => void;
  interactive?: boolean;
  hidden?: boolean;
}) {
  const [active, setActive] = useState(false);
  const lineColor = active ? 'bg-[#4F6BED]' : 'bg-zinc-300 dark:bg-zinc-800';
  return (
    <div
      className={`relative shrink-0 group ${
        hidden
          ? 'hidden'
          : interactive
            ? 'cursor-col-resize'
            : 'pointer-events-none'
      }`}
      style={{
        width: '11px',
        marginLeft: '-5px',
        marginRight: '-5px',
        zIndex: 10,
      }}
      onMouseDown={interactive ? onMouseDown : undefined}
      onMouseEnter={interactive ? () => setActive(true) : undefined}
      onMouseLeave={interactive ? () => setActive(false) : undefined}
    >
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${lineColor}`}
      />
      <span className="block h-full w-full" />
    </div>
  );
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export function SplitView({
  left,
  middle,
  right,
  leftCollapsed,
  showRight,
}: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const [animate, setAnimate] = useState(false);

  const paneWidths = useUiStore((s) => s.paneWidths);
  const dragging = useLayoutStore((s) => s.dragging);
  const preview = useLayoutStore((s) => s.preview);
  const beginDrag = useLayoutStore((s) => s.beginDrag);
  const moveDrag = useLayoutStore((s) => s.moveDrag);
  const endDrag = useLayoutStore((s) => s.endDrag);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimate(true));
    const onResize = (): void => setViewportTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    const el = containerRef.current;
    const ro = new ResizeObserver(() => setViewportTick((t) => t + 1));
    if (el) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, []);

  const containerWidth = (): number | null => {
    void viewportTick;
    const w = containerRef.current?.clientWidth ?? 0;
    return w > 0 ? w : null;
  };

  const leftWidth = preview?.left ?? paneWidths.left;
  const rightWidth = preview?.right ?? paneWidths.right;

  const displayLeft = useMemo(() => {
    const w = containerWidth();
    return w == null ? null : clamp(leftWidth, 0, w * 0.3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftWidth, viewportTick, paneWidths]);

  const displayRight = useMemo(() => {
    const w = containerWidth();
    return w == null ? null : clamp(rightWidth, w * 0.25, w * 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightWidth, viewportTick, paneWidths]);

  const transitionClass =
    animate && !dragging ? 'transition-[width] duration-200' : '';

  const startDrag = (which: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    beginDrag(which, e.clientX, container.clientWidth, !!leftCollapsed);
    const onMove = (ev: MouseEvent): void => moveDrag(ev.clientX);
    const onUp = (): void => {
      endDrag();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div ref={containerRef} className="w-full h-full flex min-w-0">
      {/* 左栏：收起 = 窄图标栏（固定宽，不可拖拽）；展开 = 可拖拽宽度 */}
      <div
        className={`shrink-0 min-w-0 overflow-hidden ${transitionClass}`}
        style={{
          width: leftCollapsed
            ? `${LEFT_COLLAPSED_PX}px`
            : displayLeft != null
              ? `${displayLeft}px`
              : undefined,
        }}
      >
        {left}
      </div>

      {/* 边界 1：左栏与中栏分隔线——展开态拖拽调宽/收起态向外拖拽展开；始终可交互 */}
      <Divider onMouseDown={startDrag('left')} />

      {/* 中栏（弹性）——data-pane 供浮动面板夹取移动范围（不越出资源面板） */}
      <div data-pane="resource" className="flex-1 min-w-0 overflow-hidden">
        {middle}
      </div>

      {/* 右栏（可选） */}
      {right != null && (
        <>
          <Divider
            onMouseDown={startDrag('right')}
            interactive={showRight !== false}
            hidden={showRight === false}
          />
          <div
            className={`shrink-0 min-w-0 overflow-hidden ${transitionClass}`}
            style={{
              width:
                showRight === false
                  ? '0px'
                  : displayRight != null
                    ? `${displayRight}px`
                    : undefined,
            }}
          >
            {right}
          </div>
        </>
      )}
    </div>
  );
}

/** 直接读取布局宽度（非组件场景用；保持与 store 同步语义）。 */
export const readPaneWidths = {
  left: layoutLeftWidth,
  right: layoutRightWidth,
};
