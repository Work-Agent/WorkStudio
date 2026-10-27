/**
 * 思考档位切换器（/thinking 命令入口）：打开事件由命令域派发，本组件只订阅。
 */
import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { runtimeCmd } from '../../api/runtime';
import { OPEN_THINKING_SWITCHER_EVT } from '../../state/commands';
import { useConversationStore } from '../../state/conversation';

/** pi 原生档位顺序。 */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const LABELS: Record<string, string> = {
  off: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
};

export function ThinkingSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const level = useConversationStore((s) => s.piThinkingLevel) ?? 'off';

  useEffect(() => {
    const onCmdOpen = (): void => setOpen(true);
    document.addEventListener(OPEN_THINKING_SWITCHER_EVT, onCmdOpen);
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener(OPEN_THINKING_SWITCHER_EVT, onCmdOpen);
      document.removeEventListener('mousedown', handler);
    };
  }, []);

  /** 切档：pi 原生 set_thinking_level（秒切 + per-model 记忆持久化）。 */
  const select = (lv: string): void => {
    setOpen(false);
    void runtimeCmd('agent.setThinking', { level: lv }).then(() => {
      // thinking_level_changed 事件会更新实况；此处乐观更新（钳制后实际档位以事件为准）
      useConversationStore.getState().setThinkingLevelOptimistic(lv);
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] rounded transition-colors"
      >
        <Brain className="w-3 h-3" />
        <span>{LABELS[level]}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-28 bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg py-1 z-50">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => select(lv)}
              className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors ${
                lv === level
                  ? 'text-[#4F6BED] font-medium'
                  : 'text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {LABELS[lv]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
