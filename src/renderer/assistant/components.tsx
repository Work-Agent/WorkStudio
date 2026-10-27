/** 助手视图的消息行与浮动缩放把手。 */
import { MoveDiagonal2 } from 'lucide-react';
import type { ParsedMessage, ResizeDirection } from '../../shared/types';

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

export function MessageRow({ message }: { message: ParsedMessage }) {
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
      {message.blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">
              {block.text}
            </div>
          );
        }
        if (block.type === 'thinking') {
          return (
            <details
              key={i}
              className="border-l-2 border-zinc-300 dark:border-zinc-700 pl-2.5 text-zinc-500 dark:text-zinc-400"
            >
              <summary className="cursor-pointer text-[11px]">思考过程</summary>
              <div className="whitespace-pre-wrap mt-1">{block.text}</div>
            </details>
          );
        }
        return (
          <div
            key={i}
            className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-zinc-600 dark:text-zinc-300"
          >
            <span className="font-medium">{block.toolName}</span>
            {block.result && (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap opacity-80">
                {block.result.slice(0, 1200)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
