/**
 * AssistantInput —— 输入区视图层（状态源 = state/input.ts 输入域 store）。
 *
 * 布局（自上而下）：token 状态行 → queue 队列卡片 → slash 补全浮层 →
 * 输入区卡片（textarea）→ 工具栏。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CornerUpLeft,
  ListPlus,
  Maximize2,
  Minimize2,
  Pencil,
  Send,
  Square,
  Terminal,
  Trash,
  TriangleAlert,
} from 'lucide-react';
import { useAppStore } from '../../state/app';
import { commandStore } from '../../state/commands';
import { useConversationStore, type QueueMode } from '../../state/conversation';
import { useInputStore } from '../../state/input';
import { setUiState, useUiStore } from '../../state/uiState';
import { ModelSwitcher } from './ModelSwitcher';
import { SkillSelector } from './SkillSelector';
import { ThinkingSwitcher } from './ThinkingSwitcher';

const QUEUE_MODE_META: Record<
  QueueMode,
  { icon: typeof CornerUpLeft; title: string; next: QueueMode }
> = {
  steer: {
    icon: CornerUpLeft,
    title: 'steer 转向——修正当前正在执行的对话\n点击切换为 followUp 排队',
    next: 'followUp',
  },
  followUp: {
    icon: ListPlus,
    title: 'followUp 排队——等当前回复完成后发送\n点击切换为 steer 转向',
    next: 'steer',
  },
};

export function AssistantInput() {
  // ── 瞬时视图态（单消费者、卸载即弃——留组件）────────────────
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── 输入域 store（单一事实源）──────────────────────────────
  const text = useInputStore((s) => s.text);
  const acItems = useInputStore((s) => s.acItems);
  const acIdx = useInputStore((s) => s.acIdx);
  const submit = useInputStore((s) => s.submit);

  // ── 派生（会话域 / 配置域 store）────────────────────────────
  const status = useAppStore((s) => s.status);
  const activePath = useUiStore((s) => s.activePath);
  const expanded = useUiStore((s) => s.inputExpanded);
  const streaming = useConversationStore((s) =>
    s.streamingSessions.has(activePath ?? '__new__'),
  );
  const piQueue = useConversationStore((s) => s.piQueue);
  const tokens = useConversationStore(
    (s) =>
      s.tokensBySession[activePath ?? '__new__'] ?? { input: 0, output: 0 },
  );

  const queueItems = useMemo(
    () => [
      ...piQueue.steering.map((t): { mode: QueueMode; text: string } => ({
        mode: 'steer',
        text: t,
      })),
      ...piQueue.followUp.map((t): { mode: QueueMode; text: string } => ({
        mode: 'followUp',
        text: t,
      })),
    ],
    [piQueue],
  );
  const queueActive = queueItems.length > 0;

  // ── 装配与回灌 ─────────────────────────────────────────────
  useEffect(() => {
    commandStore.load(); // slash 目录（builtin + get_commands 合流）
    const offRefClick = window.workbench?.onBus(({ message }) => {
      const event = message as { type?: string; ref?: string };
      if (event.type === 'refClick' && event.ref) {
        useInputStore.getState().appendToken(`@${event.ref}`);
      }
    });
    return offRefClick;
  }, []);

  /** 快捷键路径（⌘Enter=steer / ⇧⌘Enter=followUp，streaming 中）。 */
  const queueSendHotkey = (mode: QueueMode): void => {
    if (!streaming) return;
    submit(mode === 'followUp' ? 'followUp' : 'steer');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // 补全激活：↑↓ 导航 / Tab·Enter 选中 / Esc 关闭
    if (acItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        useInputStore.getState().moveCompletion(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        useInputStore.getState().moveCompletion(-1);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const target = acItems[acIdx];
        if (!target) return;
        // 输入恰为完整命令名（唯一或高亮项一致）→ Enter 直接执行，不二次确认
        if (e.key === 'Enter' && '/' + target.name === text.trim()) {
          useInputStore.getState().closeCompletions();
          submit('enter');
          return;
        }
        useInputStore.getState().applyCompletion(target.name);
        textareaRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        useInputStore.getState().closeCompletions();
        return;
      }
    }
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        queueSendHotkey(e.shiftKey ? 'followUp' : 'steer');
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        submit('enter');
      }
    }
  };

  /** 队列项编辑：出队并回填输入框。 */
  const editQueueItem = async (mode: QueueMode, t: string): Promise<void> => {
    await useConversationStore.getState().removeQueueItem(mode, t);
    useInputStore.getState().setText(t);
    textareaRef.current?.focus();
  };

  /** 未配置模型的引导入口。 */
  const openModelConfig = (): void => {
    void window.workbench?.cmd('views.open', {
      input: { type: 'settings', pageId: 'models' },
    });
  };

  const tokenTooltip = `输入 ${tokens.input.toLocaleString()} · 输出 ${tokens.output.toLocaleString()} tokens`;

  return (
    <>
      {/* token 状态行 */}
      <div className="px-3 xl:px-4 pb-0.5 shrink-0 flex items-center justify-end text-[10px] xl:text-[11px] text-zinc-400 dark:text-zinc-500">
        <span className="tabular-nums cursor-default" title={tokenTooltip}>
          ↑{tokens.input.toLocaleString()} · ↓{tokens.output.toLocaleString()}
        </span>
      </div>

      {/* queue 队列卡片 */}
      {queueActive && (
        <div
          className="mx-2.5 xl:mx-3 mb-1 bg-white dark:bg-[#232627] border border-zinc-300/80 dark:border-zinc-700 rounded-lg overflow-hidden"
          data-testid="queue-card"
        >
          <div className="flex items-center justify-between px-2.5 py-1 border-b border-zinc-100 dark:border-zinc-800">
            <button
              className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              onClick={() => setQueueCollapsed((v) => !v)}
              title={queueCollapsed ? '展开队列' : '折叠队列'}
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${queueCollapsed ? '-rotate-90' : ''}`}
              />
              <span>{queueItems.length} 条待发消息</span>
            </button>
            <button
              className="text-[10.5px] text-zinc-400 hover:text-red-500 transition-colors px-1 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]"
              onClick={() => void useConversationStore.getState().clearQueue()}
              title="清空全部队列（⌘⇧⌫）"
            >
              Clear All
            </button>
          </div>
          {!queueCollapsed && (
            <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60 max-h-[150px] overflow-y-auto">
              {queueItems.map((item) => {
                const meta = QUEUE_MODE_META[item.mode];
                const ModeIcon = meta.icon;
                return (
                  <div
                    key={`${item.mode}:${item.text}`}
                    className="group flex items-center gap-2 px-2.5 py-1.5"
                    data-testid="queue-item"
                  >
                    <button
                      className={`p-0.5 rounded shrink-0 transition-colors ${
                        item.mode === 'steer'
                          ? 'text-[#4F6BED]'
                          : 'text-zinc-400 dark:text-zinc-500'
                      } hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]`}
                      onClick={() =>
                        void useConversationStore
                          .getState()
                          .switchQueueMode(item.mode, meta.next, item.text)
                      }
                      title={meta.title}
                      data-queue-mode={item.mode}
                    >
                      <ModeIcon className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className="flex-1 min-w-0 text-[11.5px] text-zinc-700 dark:text-zinc-200 truncate"
                      title={item.text}
                    >
                      {item.text}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        className="p-0.5 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors"
                        onClick={() =>
                          void useConversationStore
                            .getState()
                            .removeQueueItem(item.mode, item.text)
                        }
                        title="删除"
                      >
                        <Trash className="w-3 h-3" />
                      </button>
                      <button
                        className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors"
                        onClick={() => void editQueueItem(item.mode, item.text)}
                        title="编辑（回填输入框）"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        className="ml-0.5 px-1.5 py-0.5 rounded text-[10px] text-[#4F6BED] bg-[#4F6BED]/10 hover:bg-[#4F6BED]/20 transition-colors"
                        onClick={() =>
                          void useConversationStore
                            .getState()
                            .sendNowQueueItem(item.mode, item.text)
                        }
                        title="立即发送"
                      >
                        Send Now
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* slash 补全浮层 */}
      {acItems.length > 0 && (
        <div className="mx-3 xl:mx-4 mb-1 bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {acItems.map((item, i) => (
            <button
              key={item.name}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-[12px] transition-colors ${
                i === acIdx
                  ? 'bg-[#4F6BED]/10 text-[#4F6BED]'
                  : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]'
              }`}
              onMouseEnter={() =>
                useInputStore.getState().highlightCompletion(i)
              }
              onMouseDown={(e) => {
                e.preventDefault();
                useInputStore.getState().applyCompletion(item.name);
                textareaRef.current?.focus();
              }}
            >
              <span className="font-mono">{item.label}</span>
              {item.hint && (
                <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 输入区卡片 */}
      <div
        className={`px-2.5 xl:px-3 pb-2.5 xl:pb-3 shrink-0 flex flex-col ${expanded ? 'h-1/2' : ''}`}
      >
        <div className="border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-[#232627] focus-within:border-zinc-400 dark:focus-within:border-zinc-500 flex flex-col flex-1 min-h-0">
          <div className="relative flex items-start px-2 pt-1.5 flex-1 min-h-0">
            {status.configured ? (
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) =>
                  useInputStore.getState().setText(e.currentTarget.value)
                }
                onKeyDown={handleKeyDown}
                rows={expanded ? undefined : 2}
                placeholder="描述要完成的业务操作…（Enter 发送，Shift+Enter 换行；执行中 Enter 自动排队；/ 唤起命令）"
                className={`min-w-0 flex-1 resize-none bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none text-[12px] xl:text-[13px] leading-normal ${
                  expanded ? 'h-full overflow-y-auto' : 'overflow-y-auto'
                }`}
              />
            ) : (
              <button
                type="button"
                onClick={openModelConfig}
                className="flex-1 flex items-center gap-1.5 text-[12px] xl:text-[13px] text-zinc-400 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-500 transition-colors text-left"
                title="配置模型后开始对话"
              >
                <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                <span className="flex-1">去配置模型 → 模型设置</span>
              </button>
            )}
            {/* 全屏按钮（输入框右上角） */}
            <button
              onClick={() => setUiState({ inputExpanded: !expanded })}
              className="absolute right-1.5 top-1 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] rounded transition-colors z-10"
              title={expanded ? '收起输入框' : '展开输入框'}
            >
              {expanded ? (
                <Minimize2 className="w-3 h-3 xl:w-3.5 xl:h-3.5" />
              ) : (
                <Maximize2 className="w-3 h-3 xl:w-3.5 xl:h-3.5" />
              )}
            </button>
          </div>

          {/* 工具栏 */}
          <div className="flex items-center px-2 pb-1 pt-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[10px] xl:text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
            <button
              onClick={() => {
                useInputStore.getState().insertSlash();
                textareaRef.current?.focus();
              }}
              className={`p-1 rounded transition-colors ${
                text.startsWith('/')
                  ? 'text-[#4F6BED]'
                  : 'hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]'
              }`}
              title="Slash 命令"
            >
              <Terminal className="w-3 h-3 xl:w-3.5 xl:h-3.5" />
            </button>
            <ThinkingSwitcher />
            <SkillSelector />
            <div className="ml-auto flex items-center gap-1">
              <ModelSwitcher />
              {/* 发送键：streaming 时变停止 */}
              {streaming ? (
                <button
                  onClick={() =>
                    void useConversationStore
                      .getState()
                      .abort(useConversationStore.getState().currentKey())
                  }
                  className="p-1 text-red-500 hover:text-red-600 transition-colors"
                  title="停止生成（Esc）"
                >
                  <Square className="w-3.5 h-3.5 xl:w-4 xl:h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => submit('enter')}
                  className="p-1 text-[#4F6BED] hover:text-[#3D56E0] disabled:opacity-40"
                  disabled={!status.configured || !text.trim()}
                  title="发送（Enter）"
                >
                  <Send className="w-3.5 h-3.5 xl:w-4 xl:h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
