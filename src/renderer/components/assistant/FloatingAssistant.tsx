/**
 * FloatingAssistant —— AI 会话面板的浮动形态（独立浮动框）。
 *
 * 三种形态：停靠右栏（aiOpen && !aiFloating）/ 浮动（aiOpen && aiFloating）/ 收起（!aiOpen）。
 * 浮层可拖拽（标题栏）与缩放（右下角），**移动/缩放范围夹取在中栏资源面板内**
 * （不越出资源面板、不盖住侧栏与标题栏）；同一次运行内隐藏再显示保持几何
 * （模块级缓存），几何不落盘（瞬时视图态）。
 */
import { useEffect, useRef, useState } from 'react';
import { GripHorizontal, MoveDiagonal2, PanelRight, X } from 'lucide-react';
import { setUiState } from '../../state/uiState';
import { AssistantPanel } from './AssistantPanel';

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 340;
const MIN_H = 380;
const MARGIN = 16;

interface PaneBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 浮动范围 = 中栏资源面板（SplitView 中栏 data-pane 元素）；缺失时回退工作台区域。 */
function getPaneBounds(): PaneBounds {
  const el = document.querySelector<HTMLElement>('[data-pane="resource"]');
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    }
  }
  return {
    left: 0,
    top: 40,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
}

/** 同一次运行内隐藏再显示保持几何；刷新后回默认（瞬时态不落盘）。 */
let sessionGeometry: Geometry | null = null;

function defaultGeometry(): Geometry {
  const b = getPaneBounds();
  const availW = b.right - b.left;
  const availH = b.bottom - b.top;
  const w = Math.min(460, Math.max(240, availW - MARGIN * 2));
  const h = Math.min(680, Math.max(240, availH - MARGIN * 2));
  return clampGeometry(
    { w, h, x: b.right - w - MARGIN, y: b.bottom - h - MARGIN },
    b,
  );
}

/** 夹取：整体限定在资源面板内（面板过小时以面板尺寸为准）。 */
function clampGeometry(
  g: Geometry,
  bounds: PaneBounds = getPaneBounds(),
): Geometry {
  const availW = Math.max(200, bounds.right - bounds.left);
  const availH = Math.max(200, bounds.bottom - bounds.top);
  const w = Math.min(Math.max(g.w, Math.min(MIN_W, availW)), availW);
  const h = Math.min(Math.max(g.h, Math.min(MIN_H, availH)), availH);
  const x = Math.min(Math.max(g.x, bounds.left), bounds.right - w);
  const y = Math.min(Math.max(g.y, bounds.top), bounds.bottom - h);
  return { x, y, w, h };
}

export function FloatingAssistant() {
  const [geo, setGeo] = useState<Geometry>(() =>
    clampGeometry(sessionGeometry ?? defaultGeometry()),
  );
  const geoRef = useRef(geo);
  geoRef.current = geo;

  useEffect(() => {
    sessionGeometry = geo;
  }, [geo]);

  // 窗口/资源面板尺寸变化：夹回资源面板内（侧栏拖拽/收起同样触发）
  useEffect(() => {
    const onResize = (): void => setGeo((g) => clampGeometry(g));
    window.addEventListener('resize', onResize);
    const pane = document.querySelector('[data-pane="resource"]');
    const observer = pane ? new ResizeObserver(onResize) : null;
    if (pane && observer) observer.observe(pane);
    onResize(); // 首次挂载后按真实面板边界再夹取一次（首帧时面板尚未 commit）
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  /** 标题栏拖拽移动。 */
  const startDrag = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = {
      x: e.clientX,
      y: e.clientY,
      gx: geoRef.current.x,
      gy: geoRef.current.y,
    };
    const onMove = (ev: MouseEvent): void => {
      setGeo((g) =>
        clampGeometry({
          ...g,
          x: start.gx + ev.clientX - start.x,
          y: start.gy + ev.clientY - start.y,
        }),
      );
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  /** 右下角缩放。 */
  const startResize = (e: React.MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = {
      x: e.clientX,
      y: e.clientY,
      w: geoRef.current.w,
      h: geoRef.current.h,
    };
    const onMove = (ev: MouseEvent): void => {
      setGeo((g) =>
        clampGeometry({
          ...g,
          w: start.w + ev.clientX - start.x,
          h: start.h + ev.clientY - start.y,
        }),
      );
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      data-testid="floating-assistant"
      className="fixed z-[70] flex flex-col rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-[#1E2021] shadow-2xl shadow-black/25 overflow-hidden"
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }}
    >
      {/* 标题栏：拖拽把手 + 停靠/关闭 */}
      <div
        className="h-9 shrink-0 flex items-center gap-2 px-2.5 border-b border-zinc-200 dark:border-zinc-800 select-none cursor-move"
        onMouseDown={startDrag}
        title="拖动以移动"
      >
        <GripHorizontal className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
          AI 助手
        </span>
        <span className="flex-1" />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setUiState({ aiFloating: false })}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] transition-colors"
          title="停靠到右栏"
          data-testid="assistant-dock"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setUiState({ aiOpen: false })}
          className="p-1 rounded-md text-zinc-400 hover:text-red-500 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] transition-colors"
          title="收起（保留浮动形态）"
          data-testid="assistant-hide"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 会话面板（与停靠态同一组件：tabs / 消息流 / 输入区） */}
      <div className="flex-1 min-h-0">
        <AssistantPanel />
      </div>

      {/* 右下角缩放命中区 */}
      <div
        className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize text-zinc-400/70 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
        onMouseDown={startResize}
        title="拖动以调整大小"
      >
        <MoveDiagonal2 className="w-3.5 h-3.5 absolute right-1 bottom-1" />
      </div>
    </div>
  );
}
