import { TaskStatus } from './TaskStatus';
import { useAppTask } from './appState';
/**
 * AI 助手视图（独立渲染进程）—— S4，主进程事实的投影。
 *
 * 形态（architecture.md §2.5）：
 *   停靠 = 单排 tabs（tabs 右端：浮动 / 新会话），无独立标题行；
 *   浮动 = 拖拽标题栏 + 同一排 tabs；移动/缩放交主进程交互层。
 * 会话标签集合语义（打开/关闭/激活）在主进程（session.openTab / closeTabs）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  GripHorizontal,
  Maximize2,
  MessageCirclePlus,
  Terminal,
  Minimize2,
  PanelRight,
  PictureInPicture2,
  Send,
  Square,
  X,
} from 'lucide-react';
import type { ResizeDirection, ThinkingLevel } from '../../shared/types';
import '../index.css';
import { bridge } from './bridge';
import { matchCommands, runBuiltinCommand, useCommands } from './commands';
import { DockResizeHandle, MessageRow, ResizeHandles } from './components';
import { formatTokens, tabLabel } from './format';
import { useMessages } from './messages';
import { useAgent, useModels, useSessions, useShell } from './session';

// 浮动圆角依赖视图透明：页面画布与 body 不得有底色（面板底色由根容器负责）。
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';

// ─── 页面 ─────────────────────────────────────────────────

interface PopupItem {
  id: string;
  label: string;
  disabled?: boolean;
}

function Assistant() {
  const shell = useShell();
  const agent = useAgent();
  const task = useAppTask();
  const taskBusy =
    !!task && ['running', 'stopping', 'unconfirmed'].includes(task.status);
  const ui = shell?.ui;
  const activePath = ui?.activePath ?? null;
  const [closedPaths, setClosedPaths] = useState<Set<string>>(new Set());
  const allOpenPaths = ui?.openPaths ?? [];
  const openPaths = allOpenPaths.filter((path) => !closedPaths.has(path));
  const sessions = useSessions(openPaths);
  const {
    messages,
    streaming,
    optimistic: optimisticText,
    pushOptimistic,
    clearNewTask,
  } = useMessages(activePath);
  const floating = ui?.aiFloating ?? false;
  const [inputExpanded, setInputExpanded] = useState(false);
  const activeTokens = sessions.find((s) => s.path === activePath)?.tokens;

  const [text, setText] = useState('');
  const [commandTag, setCommandTag] = useState<string | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<
    Record<string, string | undefined>
  >({});
  const [extensionWidgets, setExtensionWidgets] = useState<
    Record<string, string[] | undefined>
  >({});
  const [workingMessage, setWorkingMessage] = useState<string | undefined>();
  // 模型列表来自状态路径订阅：设置页增删模型后面板立即跟随，不依赖当前模型变化。
  const models = useModels();
  const [thinkingLevels, setThinkingLevels] = useState<ThinkingLevel[]>([]);
  const [menu, setMenu] = useState<'model' | 'thinking' | 'skills' | null>(
    null,
  );
  const [skills, setSkills] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [acIdx, setAcIdx] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const tagRef = useRef<HTMLDivElement | null>(null);
  const [tagWidth, setTagWidth] = useState(0);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const commands = useCommands(activePath);
  const acItems = useMemo(() => {
    if (acDismissed || !text.startsWith('/') || text.includes('\n')) return [];
    const fragment = text.slice(1).split(' ')[0] ?? '';
    if (fragment !== text.slice(1)) return [];
    return matchCommands(commands, fragment);
  }, [acDismissed, commandTag, commands, text]);

  useEffect(() => {
    setAcIdx(0);
    setAcDismissed(false);
  }, [text]);

  useLayoutEffect(() => {
    setTagWidth(commandTag ? (tagRef.current?.offsetWidth ?? 0) : 0);
  }, [commandTag]);

  useEffect(() => {
    const onEditor = (event: Event): void => {
      const detail = (event as CustomEvent<{ text: string; paste?: boolean }>)
        .detail;
      setCommandTag(null);
      setText((previous) =>
        detail.paste && previous ? previous + detail.text : detail.text,
      );
    };
    const onUi = (event: Event): void => {
      const detail = (
        event as CustomEvent<{
          type: 'status' | 'widget' | 'working';
          key?: string;
          text?: string;
          lines?: string[];
          message?: string;
        }>
      ).detail;
      if (detail.type === 'working') {
        setWorkingMessage(detail.message);
      } else if (detail.type === 'status' && detail.key) {
        setExtensionStatus((previous) => ({
          ...previous,
          [detail.key!]: detail.text,
        }));
      } else if (detail.type === 'widget' && detail.key) {
        setExtensionWidgets((previous) => ({
          ...previous,
          [detail.key!]: detail.lines,
        }));
      }
    };
    window.addEventListener('wa:editor-text', onEditor);
    window.addEventListener('wa:extension-ui', onUi);
    return () => {
      window.removeEventListener('wa:editor-text', onEditor);
      window.removeEventListener('wa:extension-ui', onUi);
    };
  }, []);

  useEffect(() => {
    void bridge?.cmd('agent.thinkingLevels').then((r) => {
      if (r.ok) setThinkingLevels((r.data as ThinkingLevel[]) ?? []);
    });
  }, [agent?.provider, agent?.modelId]);

  useEffect(() => {
    const refresh = (): void => {
      void bridge
        ?.cmd<Array<{ name: string; description: string; builtin?: boolean }>>(
          'skills.list',
        )
        .then((response) => {
          if (!response.ok) return;
          setSkills(response.data);
          setSelectedSkills((current) =>
            current.filter((name) =>
              response.data.some((skill) => skill.name === name),
            ),
          );
        });
    };
    refresh();
    const off = window.appBridge?.on((frame) => {
      if (frame.type === 'state' && frame.path === '/piconf') refresh();
    });
    void window.appBridge?.watch(['/piconf']);
    return () => {
      off?.();
    };
  }, [activePath]);

  // 从会话列表重新打开已关闭的标签时恢复显示。
  useEffect(() => {
    if (!activePath) return;
    setClosedPaths((previous) => {
      if (!previous.has(activePath)) return previous;
      const next = new Set(previous);
      next.delete(activePath);
      return next;
    });
  }, [activePath]);

  // 自动滚动：距底 <80px 才跟随
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    queueMicrotask(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, messages.length]);

  const closeTabs = (paths: string[]): void => {
    if (taskBusy && activePath && paths.includes(activePath)) return;
    const closing = new Set(paths);
    const remaining = openPaths.filter((path) => !closing.has(path));
    setClosedPaths((previous) => {
      const next = new Set(previous);
      for (const path of paths) next.add(path);
      return next;
    });
    void bridge?.cmd('session.closeTabs', { paths });
    if (!activePath || !closing.has(activePath)) return;
    // 关闭活跃标签：优先右侧相邻，其次左侧；全部关闭回到新会话。
    const index = openPaths.indexOf(activePath);
    const nextActive =
      remaining.length > 0
        ? remaining[Math.min(index, remaining.length - 1)]
        : null;
    if (nextActive) {
      void bridge?.cmd('session.openTab', { path: nextActive });
    } else {
      clearNewTask();
      void bridge?.cmd('session.new');
    }
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ── tab 右键菜单（原生 Menu.popup；关闭族语义与资源面板一致）──
  const runTabAction = (actionId: string): void => {
    const [action, path] = actionId.split(':');
    const state = openPaths;
    if (action === 'close' && path) closeTabs([path]);
    else if (action === 'closeOthers' && path)
      closeTabs(state.filter((p) => p !== path));
    else if (action === 'closeLeft' && path)
      closeTabs(state.slice(0, state.indexOf(path)));
    else if (action === 'closeRight' && path)
      closeTabs(state.slice(state.indexOf(path) + 1));
    else if (action === 'closeAll') closeTabs([...state]);
  };

  const openTabMenu = (anchor: string): void => {
    const idx = openPaths.indexOf(anchor);
    const items: PopupItem[] = [
      { id: `close:${anchor}`, label: '关闭' },
      {
        id: `closeOthers:${anchor}`,
        label: '关闭其他',
        disabled: openPaths.length <= 1,
      },
      { id: `closeLeft:${anchor}`, label: '关闭左侧', disabled: idx <= 0 },
      {
        id: `closeRight:${anchor}`,
        label: '关闭右侧',
        disabled: idx < 0 || idx >= openPaths.length - 1,
      },
      { id: 'closeAll', label: '关闭全部' },
    ];
    void bridge?.popupMenu({ items }).then((actionId) => {
      if (actionId) runTabAction(actionId);
    });
  };

  const submit = async (
    mode: 'prompt' | 'steer' | 'followUp' = 'prompt',
  ): Promise<void> => {
    const value = commandTag
      ? `/${commandTag}${text.trim() ? ` ${text.trim()}` : ''}`
      : text.trim();
    const api = bridge;
    if (!value || !api) return;
    if (value.startsWith('/')) {
      const consumed = await runBuiltinCommand(value, {
        activePath,
        messages,
        newSession: async () => {
          await api.cmd('session.new');
          clearNewTask();
        },
        openModel: () => setMenu('model'),
        openThinking: () => setMenu('thinking'),
      });
      if (consumed) {
        setText('');
        setCommandTag(null);
        return;
      }
    }
    if (taskBusy && mode === 'prompt') return;
    setText('');
    setCommandTag(null);
    const queued = streaming || Boolean(agent?.isStreaming);
    pushOptimistic(value, queued);
    if (queued) {
      await api.cmd(
        mode === 'followUp' ? 'session.followUp' : 'session.steer',
        { text: value },
      );
      return;
    }
    await api.cmd('session.prompt', {
      text: value,
      newSession: !activePath,
      activeSkills: selectedSkills,
    });
  };

  const applyCompletion = (name: string): void => {
    setCommandTag(name);
    setText('');
    setInputScrollTop(0);
    setAcDismissed(true);
    textareaRef.current?.focus();
  };

  const toggleSkill = async (name: string): Promise<void> => {
    setSelectedSkills((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const [dragging, setDragging] = useState(false);

  // 发起方拥有完整的拖拽序列（pointerdown 命中的视图会持续收到 move/up）：
  // 主进程几何更新仍以 screen 光标为准，这里只负责“按键仍按下”的节流上报与收尾。
  useEffect(() => {
    const api = bridge;
    if (!dragging || !api) return;
    // 发起方拥有拖拽序列（OS 语义：pointerdown 命中的视图持续收到 move/up）；
    // 这里不做按键过滤（不同平台/事件的 buttons 位不可靠），只上报“仍在拖”。
    let frame = 0;
    const onMove = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void api.interaction.move();
      });
    };
    const stop = (): void => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setDragging(false);
      void api.interaction.end();
    };
    // 注意：不要监听 window blur —— 交互开始后捕获层会抢焦点，blur 是正常现象；
    // 真正的“焦点离开整个窗口”由主进程 win.on('blur') 兜底。
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('mouseup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging]);

  const startDrag = (e: React.PointerEvent): void => {
    if (!floating || !bridge || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, [data-no-drag]')) return;
    e.preventDefault();
    setDragging(true);
    void bridge.interaction.begin({
      type: 'view-move',
      target: 'assistant',
      anchor: { x: e.clientX, y: e.clientY },
    });
  };

  const startResize = (
    e: React.PointerEvent,
    direction: ResizeDirection,
  ): void => {
    if (!floating || !bridge) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    void bridge.interaction.begin({
      type: 'view-resize',
      target: 'assistant',
      direction,
      anchor: { x: e.clientX, y: e.clientY },
    });
  };

  const setUi = (patch: { aiFloating?: boolean }): void => {
    void bridge?.cmd('ui.set', { patch });
  };

  const currentModel = useMemo(
    () =>
      models.find(
        (m) => m.provider === agent?.provider && m.modelId === agent?.modelId,
      ),
    [models, agent?.provider, agent?.modelId],
  );

  const canSend =
    Boolean(agent?.configured) &&
    !taskBusy &&
    (text.trim().length > 0 || commandTag !== null);
  const showEmpty = messages.length === 0 && !streaming && !optimisticText;

  return (
    <div
      className={`relative h-screen w-full flex flex-col bg-[var(--biz-surface)] text-[var(--biz-text)] text-[12px] overflow-hidden ${
        floating
          ? 'rounded-xl border border-[var(--biz-border)] border-[var(--biz-border)]'
          : ''
      }`}
    >
      {!floating && <DockResizeHandle />}
      {/* 会话标签栏（单排；浮动态此排即标题栏：把手/空白处拖拽移动） */}
      <div
        className="h-9 shrink-0 flex items-stretch border-b border-[var(--biz-border)] bg-[var(--biz-surface)] select-none"
        style={floating ? { cursor: 'move' } : undefined}
        onPointerDown={floating ? startDrag : undefined}
      >
        {floating && (
          <div
            className="shrink-0 flex items-center pl-2 pr-1 text-[var(--biz-text-muted)]"
            title="拖动以移动"
          >
            <GripHorizontal className="w-3.5 h-3.5" />
          </div>
        )}
        <div className="flex flex-1 items-stretch overflow-x-auto min-w-0 tab-scroll">
          {openPaths.map((path) => {
            const isActive = path === activePath;
            const isStreaming = isActive && taskBusy;
            const label =
              isActive && !sessions.some((session) => session.path === path)
                ? '新任务'
                : tabLabel(sessions, path);
            return (
              <div
                key={path}
                data-no-drag
                onClick={() => {
                  if (!taskBusy || isActive)
                    void bridge?.cmd('session.openTab', { path });
                }}
                aria-disabled={taskBusy && !isActive}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openTabMenu(path);
                }}
                title={label}
                className={`group relative flex items-center justify-center gap-1.5 px-5 shrink-0 cursor-pointer border-r border-[var(--biz-border)] transition-colors max-w-32 min-w-0 ${
                  isActive
                    ? 'bg-[var(--biz-bg)] dark:bg-[var(--biz-surface-hover)] text-[var(--biz-text)] text-[var(--biz-text)]'
                    : 'text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)]'
                }`}
              >
                {isActive && (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--biz-accent)] rounded-b" />
                )}
                {isStreaming && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[var(--biz-accent)] animate-pulse shrink-0"
                    title="正在执行"
                  />
                )}
                <span className="text-[12px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                  {label}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTabs([path]);
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--biz-text-muted)] hover:text-red-500 hover:bg-[var(--biz-surface)] dark:hover:bg-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  disabled={taskBusy && isActive}
                  title={
                    taskBusy && isActive
                      ? '执行中，请先停止任务'
                      : '关闭标签（数据保留）'
                  }
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {activePath === null && (
            <div
              data-testid="chat-tab-new"
              className="relative flex items-center justify-center px-5 shrink-0 border-r border-[var(--biz-border)] bg-[var(--biz-bg)] dark:bg-[var(--biz-surface-hover)] text-[var(--biz-text)] max-w-32"
              title="新任务（发送后成为独立会话）"
            >
              <span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--biz-accent)] rounded-b" />
              <span className="text-[12px] whitespace-nowrap">新任务</span>
            </div>
          )}
        </div>

        {/* 停止（执行中，标签栏右端常驻） */}
        {taskBusy && (
          <button
            onClick={() => void bridge?.cmd('session.abort')}
            className="shrink-0 px-2.5 flex items-center border-l border-[var(--biz-border)] text-red-500 hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)]"
            disabled={task?.status === 'stopping'}
            title="停止执行"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        )}

        {/* 形态切换：浮动态 → 停靠；停靠态 → 浮动（收起由 TitleBar 💬 负责） */}
        <button
          onClick={() => setUi({ aiFloating: !floating })}
          className="shrink-0 px-2.5 flex items-center border-l border-[var(--biz-border)] text-[var(--biz-text-muted)] text-[var(--biz-text)] hover:text-[var(--biz-accent)] dark:hover:text-[var(--biz-accent)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)]"
          title={floating ? '停靠到右栏' : '浮动为独立面板'}
        >
          {floating ? (
            <PanelRight className="w-3.5 h-3.5" />
          ) : (
            <PictureInPicture2 className="w-3.5 h-3.5" />
          )}
        </button>

        {/* 新会话（tabs 栏右端常驻） */}
        <button
          onClick={() => {
            void (async () => {
              await bridge?.cmd('session.new');
              // 新任务桶作废（否则再次新建会看到上一次草稿）
              clearNewTask();
            })();
          }}
          disabled={!agent?.configured || taskBusy}
          className="shrink-0 px-2.5 flex items-center border-l border-[var(--biz-border)] text-[var(--biz-text-muted)] text-[var(--biz-text)] hover:text-[var(--biz-accent)] dark:hover:text-[var(--biz-accent)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface-hover)] disabled:opacity-40"
          title={agent?.configured ? '新会话' : '配置模型后可用'}
        >
          <MessageCirclePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex justify-end px-4 py-1">
        <button
          className="text-[11px] text-[var(--biz-text-muted)]"
          onClick={() =>
            void window.appBridge?.call('/settings/open', {
              pageId: 'sessions',
            })
          }
        >
          会话历史
        </button>
      </div>
      {/* 消息流 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3"
      >
        {showEmpty && agent?.configured && (
          <div className="h-full flex flex-col items-center justify-center text-[var(--biz-text-muted)] gap-2">
            <span className="text-[13px]">描述一个任务开始工作</span>
            <span className="text-[11px]">
              从左侧打开资料，或说明需要生成的成果
            </span>
          </div>
        )}
        {showEmpty && !agent?.configured && (
          <div className="h-full flex items-center justify-center text-[var(--biz-text-muted)]">
            <div className="text-center space-y-3">
              <p>连接模型，开始与资料协作</p>
              <button
                className="wb-button"
                onClick={() =>
                  void window.appBridge?.call('/settings/open', {
                    pageId: 'models',
                  })
                }
              >
                连接模型
              </button>
              <p className="text-[11px]">你现在也可以继续编辑本地资料。</p>
            </div>
          </div>
        )}
        {messages.map((message, i) => (
          <MessageRow key={i} message={message} />
        ))}
        <TaskStatus key={task?.id ?? 0} task={task} activePath={activePath} />
      </div>

      {(workingMessage ||
        Object.values(extensionStatus).some(Boolean) ||
        Object.values(extensionWidgets).some((lines) => lines?.length)) && (
        <div className="shrink-0 px-3 pt-1 text-[10.5px] text-[var(--biz-text-muted)] space-y-0.5">
          {workingMessage && <div>{workingMessage}</div>}
          {Object.entries(extensionStatus).map(([key, value]) =>
            value ? <div key={key}>{value}</div> : null,
          )}
          {Object.entries(extensionWidgets).map(([key, lines]) =>
            lines?.length ? (
              <div key={key} className="font-mono whitespace-pre-wrap">
                {lines.join('\n')}
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* token 状态行（会话 token 统计；与消息流同源） */}
      {activeTokens && (
        <div className="shrink-0 px-3 pt-1 flex justify-end text-[10.5px] text-[var(--biz-text-muted)]">
          <span
            className="tabular-nums cursor-default"
            title={`输入 ${activeTokens.input.toLocaleString()} · 输出 ${activeTokens.output.toLocaleString()} tokens`}
          >
            ↑{formatTokens(activeTokens.input)} · ↓
            {formatTokens(activeTokens.output)}
          </span>
        </div>
      )}

      {/* 输入区：单卡片（textarea + 工具栏） */}
      <div
        className={`shrink-0 px-2.5 pb-2.5 pt-1 flex flex-col ${
          inputExpanded ? 'h-1/2 min-h-[180px]' : ''
        }`}
      >
        <div className="border border-[var(--biz-border)] rounded-lg bg-[var(--biz-bg)] dark:bg-[var(--biz-bg)] focus-within:border-[var(--biz-border)] dark:focus-within:border-[var(--biz-border)] flex flex-col flex-1 min-h-0">
          <div className="relative flex items-start px-2 pt-1.5 flex-1 min-h-0">
            {acItems.length > 0 && (
              <div className="absolute left-1 right-1 bottom-full z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--biz-border)] bg-[var(--biz-surface)] shadow-xl">
                {acItems.map((command, index) => (
                  <button
                    key={command.name}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => applyCompletion(command.name)}
                    className={`w-full text-left px-2.5 py-1.5 text-[12px] flex items-center gap-2 ${
                      index === acIdx
                        ? 'bg-[var(--biz-surface)] bg-[var(--biz-surface)]'
                        : 'hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]'
                    }`}
                  >
                    <span className="font-mono text-[var(--biz-accent)]">
                      /{command.name}
                    </span>
                    <span className="truncate text-[10.5px] text-[var(--biz-text-muted)]">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
              {commandTag && (
                <div
                  ref={tagRef}
                  style={{
                    height: '18.75px',
                    lineHeight: '18.75px',
                    transform: `translateY(${-inputScrollTop}px)`,
                  }}
                  className="absolute left-0 top-0 z-10 flex items-center gap-0.5 rounded-md bg-[var(--biz-accent-dim)] text-[var(--biz-accent)] dark:text-[var(--biz-accent)] px-1 py-0 text-[10.5px] font-mono"
                >
                  <Terminal className="w-3 h-3" />
                  <span>/{commandTag}</span>
                  <button
                    onClick={() => setCommandTag(null)}
                    className="ml-0.5 rounded-sm hover:bg-[var(--biz-accent-dim)]"
                    title="移除命令"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                className={`w-full min-w-0 flex-1 resize-none bg-transparent text-[var(--biz-text)] placeholder:text-[var(--biz-text-muted)] dark:placeholder:text-[var(--biz-text-muted)] focus:outline-none text-[12.5px] leading-normal overflow-y-auto pr-5 ${
                  inputExpanded ? 'h-full' : ''
                }`}
                rows={inputExpanded ? undefined : 3}
                placeholder={
                  !agent?.configured
                    ? '未配置模型'
                    : commandTag
                      ? '输入参数…'
                      : '描述任务，或 / 命令'
                }
                value={text}
                disabled={!agent?.configured}
                style={{
                  textIndent: commandTag ? `${tagWidth + 6}px` : undefined,
                }}
                onScroll={(event) =>
                  setInputScrollTop(event.currentTarget.scrollTop)
                }
                onChange={(e) => {
                  const next = e.target.value;
                  const match = /^\/(\S+)\s+([\s\S]*)$/.exec(next);
                  if (match) {
                    setCommandTag(match[1]!);
                    setText(match[2] ?? '');
                    setInputScrollTop(0);
                    setAcDismissed(true);
                    return;
                  }
                  setText(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && commandTag && !text) {
                    e.preventDefault();
                    setCommandTag(null);
                    return;
                  }
                  if (acItems.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setAcIdx((index) =>
                        Math.min(index + 1, acItems.length - 1),
                      );
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setAcIdx((index) => Math.max(index - 1, 0));
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAcDismissed(true);
                      return;
                    }
                    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                      e.preventDefault();
                      const command = acItems[acIdx];
                      if (!command) return;
                      if (
                        e.key === 'Enter' &&
                        '/' + command.name === text.trim()
                      ) {
                        setText('');
                        void submit('prompt');
                        return;
                      }
                      applyCompletion(command.name);
                      return;
                    }
                  }
                  if (
                    e.key === 'Enter' &&
                    (e.metaKey || e.ctrlKey) &&
                    e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void submit('followUp');
                    return;
                  }
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void submit(
                      streaming || agent?.isStreaming ? 'steer' : 'prompt',
                    );
                  }
                }}
              />
            </div>
            <button
              onClick={() => setInputExpanded((value) => !value)}
              className="absolute right-1.5 top-1 p-1 text-[var(--biz-text-muted)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] rounded transition-colors"
              title={inputExpanded ? '收起输入框' : '展开输入框'}
            >
              {inputExpanded ? (
                <Minimize2 className="w-3 h-3" />
              ) : (
                <Maximize2 className="w-3 h-3" />
              )}
            </button>
          </div>

          {/* 工具栏：思考档位（左）· 队列状态 · 模型 + 发送/停止（右） */}
          <div className="flex items-center gap-1 px-2 pb-1 pt-1.5 border-t border-[var(--biz-border)] text-[11px] text-[var(--biz-text-muted)] shrink-0">
            <button
              onClick={() => {
                setCommandTag(null);
                setText('/');
                textareaRef.current?.focus();
              }}
              className="p-1 rounded text-[var(--biz-text-muted)] hover:text-[var(--biz-text)] dark:hover:text-[var(--biz-text)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]"
              title="命令（/）"
            >
              <Terminal className="w-3 h-3" />
            </button>

            {/* 思考档位 */}
            <div className="relative">
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]"
                onClick={() => setMenu(menu === 'thinking' ? null : 'thinking')}
                title="思考档位"
              >
                <Brain className="w-3 h-3" />
                <span>{agent?.thinkingLevel ?? 'off'}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              {menu === 'thinking' && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenu(null)}
                  />
                  <div className="absolute bottom-7 left-0 z-50 w-40 rounded-lg border border-[var(--biz-border)] bg-[var(--biz-surface)] shadow-xl">
                    {(thinkingLevels.length > 0
                      ? thinkingLevels
                      : ([agent?.thinkingLevel ?? 'off'] as ThinkingLevel[])
                    ).map((level) => (
                      <button
                        key={level}
                        className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] ${
                          level === agent?.thinkingLevel
                            ? 'text-[var(--biz-accent)] font-medium'
                            : ''
                        }`}
                        onClick={() => {
                          setMenu(null);
                          void bridge?.cmd('agent.setThinking', { level });
                        }}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 技能选择 */}
            <div className="relative">
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)]"
                onClick={() => setMenu(menu === 'skills' ? null : 'skills')}
                title="选择本轮使用的技能；未指定时使用工作区已启用技能"
              >
                <BookOpen className="w-3 h-3" />
                <span className="hidden whitespace-nowrap min-[380px]:inline">
                  {selectedSkills.length
                    ? `本轮技能 ${selectedSkills.length}`
                    : '本轮技能 全部'}
                </span>
              </button>
              {menu === 'skills' && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenu(null)}
                  />
                  <div className="absolute bottom-7 left-0 z-50 w-60 max-h-64 overflow-y-auto rounded-lg border border-[var(--biz-border)] bg-[var(--biz-surface)] shadow-xl">
                    <button
                      className="w-full text-left px-2.5 py-2 text-xs"
                      onClick={() => setSelectedSkills([])}
                    >
                      使用工作区全部已启用技能
                    </button>
                    <div className="px-2.5 pb-1 text-[10px] text-[var(--biz-text-muted)]">
                      选择单个技能可限定本轮范围
                    </div>
                    {skills.length === 0 ? (
                      <div className="px-2.5 py-2 text-[11px] text-[var(--biz-text-muted)]">
                        当前工作区没有可用技能
                      </div>
                    ) : (
                      skills.map((skill) => {
                        const active =
                          selectedSkills.length === 0 ||
                          selectedSkills.includes(skill.name);
                        return (
                          <button
                            key={skill.name}
                            className="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] flex items-start gap-1.5"
                            onClick={() => void toggleSkill(skill.name)}
                          >
                            <Check
                              className={`w-3 h-3 mt-0.5 shrink-0 ${
                                active
                                  ? 'text-[var(--biz-accent)]'
                                  : 'text-transparent'
                              }`}
                            />
                            <span className="min-w-0">
                              <span className="block truncate">
                                {skill.name}
                              </span>
                              <span className="block text-[10px] text-[var(--biz-text-muted)] truncate">
                                {skill.description}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            <span className="text-[10.5px] text-[var(--biz-text-muted)] truncate">
              {agent?.isCompacting
                ? '压缩中…'
                : agent?.pendingMessageCount
                  ? `队列 ${agent.pendingMessageCount}`
                  : ''}
            </span>
            <span className="flex-1" />

            {/* 模型切换（视图内浮层，向上展开且不越界） */}
            <div className="relative">
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[var(--biz-text-muted)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] max-w-32"
                onClick={() => setMenu(menu === 'model' ? null : 'model')}
                title="切换模型"
              >
                <span className="truncate">
                  {currentModel?.label ??
                    (agent?.configured ? agent?.modelId : '未配置')}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </button>
              {menu === 'model' && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenu(null)}
                  />
                  <div className="absolute bottom-7 right-0 z-50 w-60 max-h-64 overflow-y-auto rounded-lg border border-[var(--biz-border)] bg-[var(--biz-surface)] shadow-xl">
                    {models.length === 0 && (
                      <div className="px-2.5 py-2 text-[11px] leading-relaxed text-[var(--biz-text-muted)]">
                        还没有可用模型
                        <br />
                        在「设置 → 模型」中添加或登录
                      </div>
                    )}
                    {models.map((m) => (
                      <button
                        key={`${m.provider}/${m.modelId}`}
                        className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] ${
                          m.provider === agent?.provider &&
                          m.modelId === agent?.modelId
                            ? 'text-[var(--biz-accent)] font-medium'
                            : ''
                        }`}
                        onClick={() => {
                          setMenu(null);
                          void bridge?.cmd('agent.setModel', {
                            provider: m.provider,
                            modelId: m.modelId,
                          });
                        }}
                      >
                        {m.label}
                        <span className="ml-1 text-[10px] text-[var(--biz-text-muted)]">
                          {m.provider}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 发送 / 停止（图标键，与 Pi-Work 一致） */}
            {(task ? taskBusy : streaming || agent?.isStreaming) ? (
              <button
                className="p-1 text-red-500 hover:text-red-600 transition-colors"
                onClick={() => void bridge?.cmd('session.abort')}
                disabled={task?.status === 'stopping'}
                aria-label="停止本轮"
                title={
                  task?.status === 'stopping'
                    ? '正在等待停止确认'
                    : '停止本轮（Esc）'
                }
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                className="p-1 text-[var(--biz-accent)] hover:text-[var(--biz-accent-hover)] disabled:opacity-40 transition-colors"
                disabled={!canSend || !bridge}
                onClick={() => void submit('prompt')}
                title="发送（Enter）"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {floating && <ResizeHandles onStart={startResize} />}
    </div>
  );
}

/** 浮动面板八向缩放把手：四边 8px 带 + 四角 16px（右下角常显抓手，便于发现）。 */
function Root() {
  const shell = useShell();
  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      (shell?.ui.theme ?? 'dark') === 'dark',
    );
  }, [shell]);
  return <Assistant />;
}

createRoot(document.getElementById('root')!).render(<Root />);
