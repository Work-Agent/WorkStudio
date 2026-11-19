/**
 * SessionStatusAction —— 会话行图标区的状态过渡组件（主列表展开项 / 二级列表共用）。
 *
 * 三态（占用关闭/删除按钮位）：
 *   streaming  旋转状态指示（#4F6BED）——常显；点击 = 停止执行
 *   justSettled ✓ 完成动画（CSS 弹入→停留→淡出，1.5s）
 *   idle       正常图标——主列表 X（关闭标签）/ 二级列表 Trash（删除）；hover 显示
 */
import type { ComponentType } from 'react';
import { Check, LoaderCircle } from 'lucide-react';

export function SessionStatusAction({
  isStreaming,
  justSettled,
  IdleIcon,
  onIdle,
  idleTitle,
  idleClass,
  onStop,
}: {
  isStreaming: boolean;
  justSettled?: boolean;
  IdleIcon: ComponentType<{ className?: string }>;
  onIdle: () => void;
  idleTitle: string;
  idleClass?: string;
  onStop?: () => void;
}) {
  const mode = isStreaming ? 'streaming' : justSettled ? 'completing' : 'idle';

  return (
    <div
      className={`absolute right-1 top-[2px] h-6 w-6 flex items-center justify-center rounded bg-inherit z-10 ${
        mode === 'idle'
          ? 'opacity-0 group-hover:opacity-100 transition-opacity'
          : 'opacity-100'
      }`}
    >
      {mode === 'streaming' ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStop?.();
          }}
          className="flex h-full w-full items-center justify-center text-[#4F6BED] hover:text-red-500 transition-colors"
          title="执行中 · 点击停止"
        >
          <LoaderCircle className="w-3 h-3 animate-spin" />
        </button>
      ) : mode === 'completing' ? (
        <span
          className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/15 session-check-pop"
          title="已完成"
        >
          <Check className="w-2.5 h-2.5 text-emerald-500" strokeWidth={3} />
        </span>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIdle();
          }}
          className={`flex h-full w-full items-center justify-center rounded transition-colors ${
            idleClass ??
            'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
          }`}
          title={idleTitle}
        >
          <IdleIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
