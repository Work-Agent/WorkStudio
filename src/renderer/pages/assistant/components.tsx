/** 助手视图的消息行与浮动缩放把手。 */
import { useEffect, useRef, useState } from 'react';
import { MoveDiagonal2 } from 'lucide-react';
import type { ParsedMessage, ResizeDirection } from '../../../shared/types.ts';
import { bridge } from './bridge.ts';
import { argsPreview, resultBody } from './format.ts';
import { renderMarkdown } from './markdown.ts';

/**
 * 停靠态左边缘拉伸把手。
 *
 * 命中区独立于视觉线：10px 透明带 + hover 时 1px 靛蓝线 + 中央短握把，
 * 避免“必须精确压到 1px 线”的难用感。拖拽序列与左栏一致：本视图发起，
 * 主进程用 screen 光标计算几何并推布局帧。
 */
export function DockResizeHandle() {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (): void => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        void bridge?.interaction.move();
      });
    };
    const stop = (): void => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      setDragging(false);
      setHover(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      void bridge?.interaction.end();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging]);

  const active = hover || dragging;

  return (
    <div
      data-testid="assistant-resize"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整助手宽度"
      className="group absolute left-0 top-0 bottom-0 z-50 w-3 cursor-col-resize touch-none"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 捕获失败时仍由主进程捕获层兜底 */
        }
        setDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        void bridge?.interaction.begin({
          type: 'pane-resize',
          target: 'right',
          anchor: { x: event.clientX, y: event.clientY },
        });
      }}
    >
      <span
        className={`pointer-events-none absolute inset-y-0 left-px w-px transition-colors ${
          active ? 'bg-[#4F6BED]' : 'bg-zinc-300 dark:bg-zinc-800'
        }`}
      />
      <span
        className={`pointer-events-none absolute left-[3px] top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-[#4F6BED]/70 transition-opacity ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}

export function ResizeHandles({
  onStart,
}: {
  onStart: (e: React.PointerEvent, direction: ResizeDirection) => void;
}) {
  const edges: Array<{ dir: ResizeDirection; cls: string }> = [
    { dir: 'n', cls: 'left-4 right-4 top-0 h-2 cursor-ns-resize' },
    { dir: 's', cls: 'left-4 right-4 bottom-0 h-2 cursor-ns-resize' },
    { dir: 'w', cls: 'top-4 bottom-4 left-0 w-2 cursor-ew-resize' },
    { dir: 'e', cls: 'top-4 bottom-4 right-0 w-2 cursor-ew-resize' },
  ];
  const corners: Array<{ dir: ResizeDirection; cls: string }> = [
    { dir: 'nw', cls: 'left-0 top-0 cursor-nwse-resize' },
    { dir: 'ne', cls: 'right-0 top-0 cursor-nesw-resize' },
    { dir: 'sw', cls: 'left-0 bottom-0 cursor-nesw-resize' },
    { dir: 'se', cls: 'right-0 bottom-0 cursor-nwse-resize' },
  ];
  return (
    <>
      {edges.map((h) => (
        <div
          key={h.dir}
          data-resize={h.dir}
          className={`absolute z-10 ${h.cls}`}
          onPointerDown={(e) => onStart(e, h.dir)}
        />
      ))}
      {corners.map((h) => (
        <div
          key={h.dir}
          data-resize={h.dir}
          className={`absolute z-10 w-4 h-4 group ${h.cls}`}
          onPointerDown={(e) => onStart(e, h.dir)}
          title="拖动以调整大小"
        >
          {h.dir === 'se' && (
            <MoveDiagonal2 className="w-3 h-3 absolute right-1 bottom-1 text-zinc-400/70 group-hover:text-[#4F6BED] dark:text-zinc-500 dark:group-hover:text-[#6c86f0] transition-colors" />
          )}
        </div>
      ))}
    </>
  );
}

export function MessageRow({
  message,
  onFork,
}: {
  message: ParsedMessage;
  onFork?: (entryId: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-[#4F6BED] text-white px-2.5 py-1.5 space-y-1">
          {message.blocks.map((b, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {b.type === 'text' ? b.text : b.type === 'thinking' ? b.text : ''}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-full space-y-1.5">
      {message.entryId && onFork && (
        <button
          type="button"
          onClick={() => onFork(message.entryId!)}
          className="text-[10px] text-zinc-400 hover:text-[#4F6BED]"
          title="从此消息创建分支"
        >
          分支
        </button>
      )}
      {message.blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <div
              key={i}
              className="md-chat"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
            />
          );
        }
        if (block.type === 'thinking') {
          return (
            <details
              key={i}
              className="border-l-2 border-zinc-300 dark:border-zinc-700 pl-2.5 text-zinc-500 dark:text-zinc-400"
            >
              <summary className="cursor-pointer text-[11px]">思考过程</summary>
              <div
                className="md-chat mt-1 text-[11.5px]"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
              />
            </details>
          );
        }
        // 工具调用：默认折叠，摘要行 = 工具名 + 参数单行预览，点击展开看详情。
        const preview = argsPreview(block.args);
        return (
          <details
            key={i}
            data-tool={block.toolName}
            className="rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 group"
          >
            <summary className="cursor-pointer select-none px-2 py-1 flex items-baseline gap-1.5 min-w-0 text-[11.5px] hover:bg-zinc-100 dark:hover:bg-zinc-800/50 rounded">
              <span className="font-medium shrink-0">{block.toolName}</span>
              {preview && (
                <span className="truncate text-zinc-400 dark:text-zinc-500 min-w-0">
                  {preview}
                </span>
              )}
            </summary>
            <div className="px-2 pb-1.5 space-y-1 min-w-0">
              {preview && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[10.5px] opacity-70">
                  {typeof block.args === 'string'
                    ? block.args
                    : JSON.stringify(block.args, null, 2)}
                </pre>
              )}
              {resultBody(block.result) && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10.5px] opacity-80">
                  {block.result}
                </pre>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
