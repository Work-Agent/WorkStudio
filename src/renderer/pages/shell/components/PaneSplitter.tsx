/**
 * 左侧面板分隔条（DOM）。
 *
 * 几何由壳层 CSS 变量驱动（sidebar 宽 / workbench 高），拖拽只改变量，不触发 React
 * 重渲染。按下 → `interaction.begin`，移动 → `interaction.move`（主进程算几何并推布局帧），
 * 松手 → `interaction.end`（提交 paneWidths）。
 *
 * 命中区在侧栏内部最后 6px；资源视图从侧栏右边缘直接开始，不绘制右侧让位带。
 */
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { command } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from '../domains/windows.ts';

export function PaneSplitter() {
  const [active, setActive] = useState(false);
  const wsId = useActiveWorkspaceId();

  return (
    <div
      data-splitter="left"
      role="separator"
      aria-orientation="vertical"
      className="shell-left-splitter cursor-col-resize group"
      onMouseDown={(e) => beginPaneDrag(e, setActive, wsId)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {/* 与 TabsBar / SidebarNav / 助手 tabs 下边框同一条线 */}
      <div
        className="absolute left-0 right-0 h-px bg-zinc-200 dark:bg-zinc-800 pointer-events-none"
        style={{ top: 'calc(var(--wb-tabbar-h) - 1px)' }}
      />
      {/* 视觉线体：1px 常显分隔线，hover / 拖拽时变靛蓝 */}
      <div
        className={`absolute inset-y-0 right-0 w-px transition-colors ${
          active ? 'bg-[#4F6BED]' : 'bg-zinc-300 dark:bg-zinc-800'
        }`}
      />
    </div>
  );
}

/** 拖拽序列由把手持有：主进程只消费 begin/move/end 三个信号。 */
function beginPaneDrag(
  e: ReactMouseEvent<HTMLDivElement>,
  setActive: (active: boolean) => void,
  wsId: string | null,
): void {
  if (!wsId) return;
  e.preventDefault();
  setActive(true);
  const begin = {
    type: 'pane-resize',
    side: 'left',
    pointerX: e.clientX,
    pointerY: e.clientY,
  };
  void command('shell', `${wsId}/layout`, 'begin', {
    input: begin,
  }).catch(() => undefined);
  let frame = 0;
  const onMove = (event: MouseEvent): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void command('shell', `${wsId}/layout`, 'move', {
        input: {
          ...begin,
          pointerX: event.clientX,
          pointerY: event.clientY,
        },
      }).catch(() => undefined);
    });
  };
  const onUp = (): void => {
    void command('shell', `${wsId}/layout`, 'end', {}).catch(() => undefined);
    cleanup();
  };
  const cleanup = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
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
