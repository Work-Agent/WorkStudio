/** Agent 页面：会话导航、对话与成果、当前请求配置。 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  BookOpen,
  ChevronDown,
  GripHorizontal,
  History,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  MoreHorizontal,
  PanelRight,
  PictureInPicture2,
  Send,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import type {
  CommandResponse,
  ResizeDirection,
  ThinkingLevel,
} from '../../shared/types';
import '../index.css';
import './page.css';
import { bridge } from './bridge';
import { matchCommands, runBuiltinCommand, useCommands } from './commands';
import { DockResizeHandle, MessageRow, ResizeHandles } from './components';
import { formatTokens, tabLabel } from './format';
import { useMessages } from './messages';
import { useAgent, useModels, useSessions, useShell } from './session';
import { useAppTask } from './appState';
import { TaskStatus } from './TaskStatus';
import { Popover } from './Popover';
import { useDraft } from './useDraft';

document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
const thinkingLabels: Record<string, string> = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '最高',
};
type Menu =
  | 'config'
  | 'skills'
  | 'commands'
  | 'more'
  | 'rename'
  | 'send'
  | null;

function Assistant() {
  const shell = useShell();
  const agent = useAgent();
  const task = useAppTask();
  const activePath = shell?.ui.activePath ?? null;
  const floating = shell?.ui.aiFloating ?? false;
  const openPaths = shell?.ui.openPaths ?? [];
  const sessions = useSessions(openPaths);
  const { messages, streaming, optimistic, pushOptimistic, clearNewTask } =
    useMessages(activePath);
  const busy = task
    ? ['running', 'stopping', 'unconfirmed'].includes(task.status)
    : streaming || !!agent?.isStreaming;
  const running = task
    ? task.status === 'running'
    : streaming || !!agent?.isStreaming;
  const locked = busy && !running;
  const draft = useDraft(
    `${agent?.workspacePath ?? ''}:${activePath ?? 'new'}`,
  );
  const { text, commandTag, selectedSkills, skillMode, update } = draft;
  const [inputExpanded, setInputExpanded] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const submission = useRef<{
    id: number;
    taskId: number | undefined;
    queued: boolean;
    accept?: () => void;
  } | null>(null);
  const submitSeq = useRef(0);
  const [rename, setRename] = useState('');
  const models = useModels();
  const [thinkingLevels, setThinkingLevels] = useState<ThinkingLevel[]>([]);
  const [skills, setSkills] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [extensionStatus, setExtensionStatus] = useState<
    Record<string, string | undefined>
  >({});
  const [extensionWidgets, setExtensionWidgets] = useState<
    Record<string, string[] | undefined>
  >({});
  const [workingMessage, setWorkingMessage] = useState<string | undefined>();
  const [acIdx, setAcIdx] = useState(0);
  const [acDismissed, setAcDismissed] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const [tagWidth, setTagWidth] = useState(0);
  const [inputScrollTop, setInputScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const commands = useCommands(activePath);
  const acItems = useMemo(() => {
    if (
      commandTag ||
      acDismissed ||
      !text.startsWith('/') ||
      text.includes('\n')
    )
      return [];
    return text.includes(' ') ? [] : matchCommands(commands, text.slice(1));
  }, [acDismissed, commandTag, commands, text]);
  const currentModel = models.find(
    (m) => m.provider === agent?.provider && m.modelId === agent?.modelId,
  );
  const activeTokens = sessions.find((s) => s.path === activePath)?.tokens;
  const currentName = activePath ? tabLabel(sessions, activePath) : '新对话';

  const check = (response: CommandResponse<unknown> | undefined): void => {
    if (!response) throw new Error('页面连接尚未就绪，请稍后重试');
    if (!response.ok) throw new Error(response.error.message);
  };
  const control = async (
    action: () => Promise<CommandResponse<unknown> | undefined>,
    close = true,
  ): Promise<boolean> => {
    if (controlPending) return false;
    setControlPending(true);
    setError('');
    try {
      check(await action());
      if (close) setMenu(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setControlPending(false);
    }
  };
  const settings = (pageId: string) =>
    control(
      () =>
        window.appBridge?.call('/settings/open', { pageId }) ??
        Promise.resolve(undefined),
    );
  const newSession = async () => {
    if (busy || submitting) return;
    if (
      await control(
        () => bridge?.cmd('session.new') ?? Promise.resolve(undefined),
      )
    ) {
      clearNewTask();
      setNotice('');
      textareaRef.current?.focus();
    }
  };
  const closeTabs = async (paths: string[]) => {
    if (busy && activePath && paths.includes(activePath)) return;
    if (
      !(await control(
        () =>
          bridge?.cmd('session.closeTabs', { paths }) ??
          Promise.resolve(undefined),
      ))
    )
      return;
    if (activePath && paths.includes(activePath)) {
      const remaining = openPaths.filter((p) => !paths.includes(p));
      const next =
        remaining[
          Math.min(openPaths.indexOf(activePath), remaining.length - 1)
        ];
      if (next)
        await control(
          () =>
            bridge?.cmd('session.openTab', { path: next }) ??
            Promise.resolve(undefined),
        );
      else await newSession();
    }
  };
  const openTabMenu = (path: string) => {
    const idx = openPaths.indexOf(path);
    const choices = [
      { id: 'close', label: '关闭', paths: [path] },
      {
        id: 'others',
        label: '关闭其他',
        paths: openPaths.filter((p) => p !== path),
      },
      { id: 'left', label: '关闭左侧', paths: openPaths.slice(0, idx) },
      { id: 'right', label: '关闭右侧', paths: openPaths.slice(idx + 1) },
      { id: 'all', label: '关闭全部', paths: openPaths },
    ];
    void bridge
      ?.popupMenu({
        items: choices.map((c) => ({
          id: c.id,
          label: c.label,
          disabled:
            !c.paths.length ||
            (busy && !!activePath && c.paths.includes(activePath)),
        })),
      })
      .then((id) => {
        const choice = choices.find((c) => c.id === id);
        if (choice) void closeTabs(choice.paths);
      });
  };

  useEffect(() => {
    setAcIdx(0);
    setAcDismissed(false);
  }, [text]);
  useLayoutEffect(() => {
    setTagWidth(commandTag ? (tagRef.current?.offsetWidth ?? 0) : 0);
  }, [commandTag]);
  useEffect(() => {
    // prompt 的调用直到整轮结束才返回；任务事实到达即恢复补充输入。
    if (
      submission.current &&
      !submission.current.queued &&
      task &&
      task.id !== submission.current.taskId
    ) {
      submission.current.accept?.();
      submission.current = null;
      setSubmitting(false);
    }
  }, [task]);
  useEffect(() => {
    setMenu(null);
    setError('');
    setNotice('');
    autoScrollRef.current = true;
    setAwayFromBottom(false);
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activePath, agent?.workspacePath]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, task]);
  useEffect(() => {
    const onEditor = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; paste?: boolean }>)
        .detail;
      update((current) => {
        const previous = current.commandTag
          ? `/${current.commandTag} ${current.text}`
          : current.text;
        return {
          ...current,
          commandTag: null,
          text: previous ? `${previous}\n${detail.text}` : detail.text,
        };
      });
      setNotice(
        text ? '原内容已追加，现有草稿已保留' : '已填入输入框，可修改后发送',
      );
      textareaRef.current?.focus();
    };
    window.addEventListener('wa:editor-text', onEditor);
    return () => window.removeEventListener('wa:editor-text', onEditor);
  }, [update, text]);
  useEffect(() => {
    const onUi = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type: 'status' | 'widget' | 'working';
          key?: string;
          text?: string;
          lines?: string[];
          message?: string;
        }>
      ).detail;
      if (detail.type === 'working') setWorkingMessage(detail.message);
      else if (detail.type === 'status' && detail.key)
        setExtensionStatus((prev) => ({ ...prev, [detail.key!]: detail.text }));
      else if (detail.type === 'widget' && detail.key)
        setExtensionWidgets((prev) => ({
          ...prev,
          [detail.key!]: detail.lines,
        }));
    };
    window.addEventListener('wa:extension-ui', onUi);
    return () => window.removeEventListener('wa:extension-ui', onUi);
  }, []);
  useEffect(() => {
    void bridge?.cmd<ThinkingLevel[]>('agent.thinkingLevels').then((r) => {
      if (r.ok) setThinkingLevels(r.data ?? []);
    });
  }, [agent?.provider, agent?.modelId]);
  useEffect(() => {
    const refresh = () => {
      void bridge
        ?.cmd<Array<{ name: string; description: string }>>('skills.list')
        .then((r) => {
          if (r.ok) setSkills(r.data ?? []);
        });
    };
    refresh();
    const off = window.appBridge?.on((frame) => {
      if (frame.type === 'state' && frame.path === '/piconf') refresh();
    });
    void window.appBridge?.watch(['/piconf']);
    return off;
  }, [agent?.workspacePath]);

  const stop = () => {
    void control(
      () => bridge?.cmd('session.abort') ?? Promise.resolve(undefined),
      false,
    );
  };
  const submit = async (
    mode: 'prompt' | 'steer' | 'followUp' = running ? 'steer' : 'prompt',
  ) => {
    const value = commandTag
      ? `/${commandTag}${text.trim() ? ` ${text.trim()}` : ''}`
      : text.trim();
    if (
      !value ||
      !bridge ||
      submitting ||
      submission.current ||
      locked ||
      controlPending
    )
      return;
    if (
      skillMode === 'selected' &&
      !selectedSkills.some((name) => skills.some((s) => s.name === name))
    ) {
      setError('请至少选择一个可用技能，或切换为自动');
      return;
    }
    const id = ++submitSeq.current;
    submission.current = { id, taskId: task?.id, queued: running };
    setSubmitting(true);
    setError('');
    setNotice('');
    setMenu(null);
    let sentToAgent = false;
    const resetSkills = () =>
      update((current) => ({
        ...current,
        selectedSkills: [],
        skillMode: 'auto',
      }));
    const clearSubmitted = () =>
      update((current) =>
        current.text === text && current.commandTag === commandTag
          ? { ...current, text: '', commandTag: null }
          : current,
      );
    try {
      if (value.startsWith('/')) {
        const consumed = await runBuiltinCommand(value, {
          activePath,
          messages,
          newSession: async () => {
            if (busy) throw new Error('本轮结束后可新建对话');
            check(await bridge!.cmd('session.new'));
            clearNewTask();
          },
          openModel: () => setMenu('config'),
          openThinking: () => setMenu('config'),
        });
        if (consumed) {
          clearSubmitted();
          return;
        }
      }
      if (busy && mode === 'prompt') return;
      sentToAgent = true;
      if (submission.current?.id === id)
        submission.current.accept = resetSkills;
      clearSubmitted();
      autoScrollRef.current = true;
      setAwayFromBottom(false);
      pushOptimistic(value, running);
      const response = running
        ? await bridge.cmd(
            mode === 'followUp' ? 'session.followUp' : 'session.steer',
            { text: value },
          )
        : await bridge.cmd('session.prompt', {
            text: value,
            newSession: !activePath,
            activeSkills:
              skillMode === 'selected'
                ? selectedSkills.filter((name) =>
                    skills.some((s) => s.name === name),
                  )
                : [],
          });
      check(response);
      if (running || submission.current?.id === id) resetSkills();
      if (running)
        setNotice(
          mode === 'followUp' ? '已排队，本轮结束后发送' : '已提交补充要求',
        );
    } catch (cause) {
      clearNewTask();
      if (sentToAgent)
        update((current) => ({
          ...current,
          commandTag: null,
          text: current.text ? `${value}\n${current.text}` : value,
        }));
      setError(
        `${cause instanceof Error ? cause.message : String(cause)}。未发送的内容已保留。`,
      );
    } finally {
      if (submission.current?.id === id) {
        submission.current = null;
        setSubmitting(false);
      }
    }
  };
  const applyCompletion = (name: string, fromInput = false) => {
    update({ commandTag: name, ...(fromInput ? { text: '' } : {}) });
    setAcDismissed(true);
    setMenu(null);
    setInputScrollTop(0);
    textareaRef.current?.focus();
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

  const canSend =
    !!agent?.configured &&
    !locked &&
    !submitting &&
    !controlPending &&
    (text.trim().length > 0 || commandTag !== null) &&
    (skillMode === 'auto' ||
      selectedSkills.some((name) => skills.some((s) => s.name === name)));
  const showEmpty =
    !messages.length &&
    !streaming &&
    !optimistic &&
    (!task || (!!task.sessionFile && task.sessionFile !== activePath));
  const toggleMenu = (next: Menu) => setMenu(menu === next ? null : next);
  const closeMenu = () => setMenu(null);
  const scrollToLatest = () => {
    autoScrollRef.current = true;
    setAwayFromBottom(false);
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  return (
    <div className={`agent-page ${floating ? 'is-floating' : ''}`}>
      {!floating && <DockResizeHandle />}
      <header
        className="agent-header"
        onPointerDown={floating ? startDrag : undefined}
      >
        {floating && (
          <span className="agent-grip" title="拖动以移动">
            <GripHorizontal size={14} />
          </span>
        )}
        <div
          className="agent-tabs tab-scroll"
          role="tablist"
          aria-label="打开的对话"
        >
          {openPaths.map((path) => (
            <div
              className={`agent-tab ${path === activePath ? 'is-active' : ''}`}
              key={path}
              data-no-drag
              onContextMenu={(e) => {
                e.preventDefault();
                openTabMenu(path);
              }}
            >
              <button
                role="tab"
                aria-selected={path === activePath}
                disabled={
                  (busy && path !== activePath) || controlPending || submitting
                }
                title={
                  busy && path !== activePath
                    ? '本轮结束后可切换对话'
                    : tabLabel(sessions, path)
                }
                onClick={() =>
                  void control(
                    () =>
                      bridge?.cmd('session.openTab', { path }) ??
                      Promise.resolve(undefined),
                  )
                }
              >
                {path === activePath && busy && (
                  <span className="agent-running-dot" />
                )}
                <span>{tabLabel(sessions, path)}</span>
              </button>
              <button
                className="agent-tab-close"
                disabled={
                  (busy && path === activePath) || controlPending || submitting
                }
                onClick={() => void closeTabs([path])}
                aria-label={`关闭${tabLabel(sessions, path)}`}
                title="关闭标签（数据保留）"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {activePath === null && (
            <span className="agent-tab-placeholder" data-testid="chat-tab-new">
              新对话
            </span>
          )}
        </div>
        <nav
          className="agent-header-actions"
          aria-label="对话操作"
          data-no-drag
        >
          <button
            className="agent-icon-button"
            title="会话历史"
            aria-label="会话历史"
            onClick={() => void settings('sessions')}
            disabled={controlPending}
          >
            <History size={15} />
            <span className="agent-wide-label">历史</span>
          </button>
          <button
            className="agent-icon-button"
            title={busy ? '本轮结束后可新建对话' : '新对话'}
            aria-label="新对话"
            onClick={() => void newSession()}
            disabled={
              !agent?.configured || busy || controlPending || submitting
            }
          >
            <MessageCirclePlus size={15} />
            <span className="agent-wide-label">新对话</span>
          </button>
          <div className="agent-anchor">
            <button
              className="agent-icon-button"
              aria-label="更多对话操作"
              aria-haspopup="dialog"
              aria-expanded={menu === 'more' || menu === 'rename'}
              onClick={() => toggleMenu('more')}
            >
              <MoreHorizontal size={16} />
            </button>
            {menu === 'more' && (
              <Popover label="对话操作" align="right" onClose={closeMenu}>
                <button
                  className="agent-menu-item"
                  disabled={!activePath || busy || controlPending}
                  onClick={() => {
                    setRename(currentName);
                    setMenu('rename');
                  }}
                >
                  重命名对话
                </button>
                <button
                  className="agent-menu-item"
                  disabled={!activePath || busy || controlPending}
                  onClick={() => activePath && void closeTabs([activePath])}
                >
                  关闭当前标签<span>保留历史记录</span>
                </button>
                <button
                  className="agent-menu-item"
                  title={floating ? '停靠到右栏' : '浮动为独立面板'}
                  onClick={() =>
                    void control(
                      () =>
                        bridge?.cmd('ui.set', {
                          patch: { aiFloating: !floating },
                        }) ?? Promise.resolve(undefined),
                    )
                  }
                >
                  {floating ? (
                    <PanelRight size={14} />
                  ) : (
                    <PictureInPicture2 size={14} />
                  )}
                  {floating ? '停靠到右栏' : '浮动为独立面板'}
                </button>
                {activeTokens && (
                  <p className="agent-menu-note">
                    本次会话用量：输入 {formatTokens(activeTokens.input)} · 输出{' '}
                    {formatTokens(activeTokens.output)} tokens
                  </p>
                )}
              </Popover>
            )}
            {menu === 'rename' && (
              <Popover label="重命名对话" align="right" onClose={closeMenu}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (rename.trim())
                      void control(
                        () =>
                          bridge?.cmd('session.rename', {
                            path: activePath,
                            name: rename.trim(),
                          }) ?? Promise.resolve(undefined),
                      );
                  }}
                >
                  <label className="agent-field">
                    对话名称
                    <input
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <button
                    className="agent-primary"
                    disabled={!rename.trim() || controlPending}
                  >
                    保存名称
                  </button>
                </form>
              </Popover>
            )}
          </div>
        </nav>
      </header>

      <div className="agent-conversation">
        <div
          ref={scrollRef}
          className="agent-messages"
          aria-label="对话消息"
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            const away = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
            autoScrollRef.current = !away;
            setAwayFromBottom(away);
          }}
        >
          {showEmpty && (
            <div className="agent-empty">
              <span className="agent-empty-mark">
                <MessageCirclePlus size={22} />
              </span>
              <h1>
                {agent?.configured
                  ? '需要我帮你完成什么？'
                  : '连接模型，开始与资料协作'}
              </h1>
              <p>
                {agent?.configured
                  ? '描述任务和希望得到的成果，资料可以从左侧打开。'
                  : '连接后即可提问、整理资料和生成文档。'}
              </p>
              {agent?.configured ? (
                <div className="agent-examples">
                  {[
                    ['总结资料', '请总结工作区资料中的重点和风险。'],
                    ['整理待办', '请从工作区资料中整理待办事项和负责人。'],
                    ['起草简报', '请基于工作区资料起草一份项目简报。'],
                  ].map(([label, value]) => (
                    <button
                      key={label}
                      onClick={() => {
                        update((current) => ({
                          ...current,
                          text: current.text
                            ? `${current.text}\n${value}`
                            : value!,
                        }));
                        textareaRef.current?.focus();
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  className="agent-primary"
                  onClick={() => void settings('models')}
                >
                  连接模型
                </button>
              )}
            </div>
          )}
          {messages.map((message, i) => (
            <MessageRow key={i} message={message} />
          ))}
          <TaskStatus key={task?.id ?? 0} task={task} activePath={activePath} />
          {(workingMessage ||
            Object.values(extensionStatus).some(Boolean) ||
            Object.values(extensionWidgets).some((lines) => lines?.length)) && (
            <details className="agent-extension">
              <summary>扩展状态</summary>
              {workingMessage && <p>{workingMessage}</p>}
              {Object.entries(extensionStatus).map(
                ([key, value]) => value && <p key={key}>{value}</p>,
              )}
              {Object.entries(extensionWidgets).map(([key, lines]) =>
                lines?.length ? <pre key={key}>{lines.join('\n')}</pre> : null,
              )}
            </details>
          )}
        </div>
        {awayFromBottom && (
          <button className="agent-latest" onClick={scrollToLatest}>
            <ArrowDown size={13} />
            回到最新
          </button>
        )}
      </div>

      <footer
        className={`agent-composer ${inputExpanded ? 'is-expanded' : ''}`}
      >
        {error && (
          <div className="agent-feedback is-error" role="alert">
            <span>{error}</span>
            <button aria-label="关闭错误提示" onClick={() => setError('')}>
              <X size={13} />
            </button>
          </div>
        )}
        {notice && !error && (
          <p className="agent-feedback" role="status">
            {notice}
          </p>
        )}
        {locked && (
          <p className="agent-feedback" role="status">
            {task?.status === 'stopping'
              ? '正在等待停止确认，草稿可以继续编辑。'
              : '尚未确认执行结束，请等待结果或再次确认停止。'}
          </p>
        )}
        <div className="agent-input-card">
          <div className="agent-textarea-area">
            {acItems.length > 0 && (
              <div
                className="agent-completions"
                role="listbox"
                aria-label="命令补全"
                id="agent-completions"
              >
                {acItems.map((command, index) => (
                  <button
                    key={command.name}
                    role="option"
                    id={`agent-command-${index}`}
                    aria-selected={index === acIdx}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyCompletion(command.name, true)}
                  >
                    <code>/{command.name}</code>
                    <span>{command.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="agent-textarea-wrap">
              {commandTag && (
                <div
                  ref={tagRef}
                  className="agent-command-tag"
                  style={{ transform: `translateY(${-inputScrollTop}px)` }}
                >
                  <Terminal size={12} />
                  <span>/{commandTag}</span>
                  <button
                    title="移除命令"
                    aria-label="移除命令"
                    onClick={() => update({ commandTag: null })}
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                aria-label="任务或补充要求"
                aria-controls={acItems.length ? 'agent-completions' : undefined}
                aria-activedescendant={
                  acItems.length ? `agent-command-${acIdx}` : undefined
                }
                rows={inputExpanded ? undefined : 3}
                placeholder={
                  !agent?.configured
                    ? '请先连接模型…'
                    : commandTag
                      ? '输入命令参数…'
                      : running
                        ? '补充要求，或说明需要调整的方向…'
                        : '描述任务和希望得到的成果…'
                }
                value={text}
                disabled={!agent?.configured}
                style={{
                  textIndent: commandTag ? `${tagWidth + 6}px` : undefined,
                }}
                onScroll={(e) => setInputScrollTop(e.currentTarget.scrollTop)}
                onChange={(e) => {
                  const value = e.target.value;
                  const match = /^\/(\S+)\s+([\s\S]*)$/.exec(value);
                  if (
                    !commandTag &&
                    match &&
                    commands.some((c) => c.name === match[1])
                  ) {
                    update({ commandTag: match[1]!, text: match[2] ?? '' });
                    setAcDismissed(true);
                  } else update({ text: value });
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Backspace' && commandTag && !text) {
                    e.preventDefault();
                    update({ commandTag: null });
                    return;
                  }
                  if (e.key === 'Escape' && acItems.length) {
                    e.preventDefault();
                    setAcDismissed(true);
                    return;
                  }
                  if (
                    acItems.length &&
                    ['ArrowDown', 'ArrowUp'].includes(e.key)
                  ) {
                    e.preventDefault();
                    setAcIdx((i) =>
                      Math.max(
                        0,
                        Math.min(
                          acItems.length - 1,
                          i + (e.key === 'ArrowDown' ? 1 : -1),
                        ),
                      ),
                    );
                    return;
                  }
                  if (
                    acItems.length &&
                    (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))
                  ) {
                    e.preventDefault();
                    const c = acItems[acIdx];
                    if (c) {
                      if (e.key === 'Enter' && `/${c.name}` === text.trim())
                        void submit();
                      else applyCompletion(c.name, true);
                    }
                    return;
                  }
                  if (
                    e.key === 'Enter' &&
                    (e.ctrlKey || e.metaKey) &&
                    e.shiftKey
                  ) {
                    e.preventDefault();
                    void submit(running ? 'followUp' : 'prompt');
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            <button
              className="agent-icon-button agent-expand"
              title={inputExpanded ? '收起输入框' : '展开输入框'}
              aria-label={inputExpanded ? '收起输入框' : '展开输入框'}
              onClick={() => setInputExpanded((v) => !v)}
            >
              {inputExpanded ? (
                <Minimize2 size={13} />
              ) : (
                <Maximize2 size={13} />
              )}
            </button>
          </div>
          <div className="agent-toolbar">
            <div className="agent-anchor">
              <button
                className="agent-config-button"
                title="模型与思考"
                aria-label="模型与思考"
                aria-haspopup="dialog"
                aria-expanded={menu === 'config'}
                onClick={() => toggleMenu('config')}
              >
                <span>
                  {currentModel?.label ??
                    (agent?.configured ? agent.modelId : '连接模型')}
                </span>
                <span className="agent-secondary">
                  · 思考{' '}
                  {thinkingLabels[agent?.thinkingLevel ?? 'off'] ??
                    agent?.thinkingLevel}
                </span>
                <ChevronDown size={12} />
              </button>
              {menu === 'config' && (
                <Popover label="模型与思考" onClose={closeMenu}>
                  <label className="agent-field">
                    当前模型
                    <select
                      aria-label="当前模型"
                      value={
                        currentModel
                          ? `${currentModel.provider}/${currentModel.modelId}`
                          : ''
                      }
                      disabled={busy || controlPending || submitting}
                      onChange={(e) => {
                        const m = models.find(
                          (m) =>
                            `${m.provider}/${m.modelId}` === e.target.value,
                        );
                        if (m)
                          void control(
                            () =>
                              bridge?.cmd('agent.setModel', {
                                provider: m.provider,
                                modelId: m.modelId,
                              }) ?? Promise.resolve(undefined),
                            false,
                          );
                      }}
                    >
                      <option value="" disabled>
                        请选择模型
                      </option>
                      {models.map((m) => (
                        <option
                          key={`${m.provider}/${m.modelId}`}
                          value={`${m.provider}/${m.modelId}`}
                        >
                          {m.label} · {m.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="agent-field">
                    思考强度
                    <select
                      aria-label="思考强度"
                      value={agent?.thinkingLevel ?? 'off'}
                      disabled={
                        busy ||
                        controlPending ||
                        submitting ||
                        !agent?.configured
                      }
                      onChange={(e) =>
                        void control(
                          () =>
                            bridge?.cmd('agent.setThinking', {
                              level: e.target.value,
                            }) ?? Promise.resolve(undefined),
                          false,
                        )
                      }
                    >
                      {(thinkingLevels.length
                        ? thinkingLevels
                        : [agent?.thinkingLevel ?? 'off']
                      ).map((level) => (
                        <option key={level} value={level}>
                          {thinkingLabels[level] ?? level}
                        </option>
                      ))}
                    </select>
                  </label>
                  {busy && (
                    <p className="agent-menu-note">
                      本轮结束后可修改模型与思考强度。
                    </p>
                  )}
                  <button
                    className="agent-menu-item"
                    onClick={() => void settings('models')}
                  >
                    管理模型与连接
                  </button>
                </Popover>
              )}
            </div>
            <div className="agent-anchor">
              <button
                className="agent-config-button agent-skills-button"
                aria-label="本轮技能"
                title={
                  running
                    ? '本轮执行中，技能可用于下一次新请求'
                    : '选择本次请求使用的技能'
                }
                aria-haspopup="dialog"
                aria-expanded={menu === 'skills'}
                disabled={busy || submitting}
                onClick={() => toggleMenu('skills')}
              >
                <BookOpen size={13} />
                <span>
                  {skillMode === 'auto'
                    ? '自动'
                    : `技能 ${selectedSkills.length}`}
                </span>
              </button>
              {menu === 'skills' && (
                <Popover label="本轮技能" onClose={closeMenu}>
                  <label className="agent-choice">
                    <input
                      type="radio"
                      name="skill-mode"
                      checked={skillMode === 'auto'}
                      onChange={() =>
                        update({ skillMode: 'auto', selectedSkills: [] })
                      }
                    />
                    自动使用工作区已启用技能
                  </label>
                  <label className="agent-choice">
                    <input
                      type="radio"
                      name="skill-mode"
                      checked={skillMode === 'selected'}
                      disabled={!skills.length}
                      onChange={() => update({ skillMode: 'selected' })}
                    />
                    指定技能
                  </label>
                  {skillMode === 'selected' && (
                    <div className="agent-skill-list">
                      {skills.map((skill) => (
                        <label className="agent-choice" key={skill.name}>
                          <input
                            type="checkbox"
                            checked={selectedSkills.includes(skill.name)}
                            onChange={() =>
                              update((current) => ({
                                ...current,
                                selectedSkills: current.selectedSkills.includes(
                                  skill.name,
                                )
                                  ? current.selectedSkills.filter(
                                      (s) => s !== skill.name,
                                    )
                                  : [...current.selectedSkills, skill.name],
                              }))
                            }
                          />
                          <span>
                            <strong>{skill.name}</strong>
                            <small>{skill.description}</small>
                          </span>
                        </label>
                      ))}
                      {!selectedSkills.length && (
                        <p className="agent-menu-note">
                          请至少选择一个技能，或使用自动模式。
                        </p>
                      )}
                    </div>
                  )}
                  {!skills.length && (
                    <p className="agent-menu-note">当前没有已启用的技能。</p>
                  )}
                  <p className="agent-menu-note">
                    仅用于下一次请求，提交后恢复自动。
                  </p>
                  <button
                    className="agent-menu-item"
                    onClick={() => void settings('skills')}
                  >
                    管理工作区技能
                  </button>
                </Popover>
              )}
            </div>
            <div className="agent-anchor">
              <button
                className="agent-icon-button"
                title="命令（/）"
                aria-label="命令"
                aria-haspopup="dialog"
                aria-expanded={menu === 'commands'}
                onClick={() => {
                  setCommandSearch('');
                  toggleMenu('commands');
                }}
              >
                <Terminal size={14} />
              </button>
              {menu === 'commands' && (
                <Popover label="命令" onClose={closeMenu}>
                  <label className="agent-field">
                    查找命令
                    <input
                      value={commandSearch}
                      onChange={(e) => setCommandSearch(e.target.value)}
                      placeholder="名称或用途…"
                    />
                  </label>
                  <div className="agent-command-list">
                    {commands
                      .filter((c) =>
                        `${c.name} ${c.description ?? ''}`
                          .toLowerCase()
                          .includes(commandSearch.toLowerCase()),
                      )
                      .map((c) => (
                        <button
                          className="agent-menu-item"
                          key={c.name}
                          onClick={() => applyCompletion(c.name)}
                        >
                          <code>/{c.name}</code>
                          <span>{c.description}</span>
                        </button>
                      ))}
                  </div>
                  <p className="agent-menu-note">
                    选择后填入命令，保留现有草稿作为参数。
                  </p>
                </Popover>
              )}
            </div>
            <div className="agent-send-actions">
              {agent?.isCompacting && (
                <span className="agent-queue">压缩中…</span>
              )}
              {!!agent?.pendingMessageCount && (
                <span className="agent-queue" role="status">
                  已排队 {agent.pendingMessageCount}
                </span>
              )}
              {(running || locked) && (
                <button
                  className="agent-stop"
                  title="停止本轮"
                  aria-label="停止本轮"
                  disabled={task?.status === 'stopping' || controlPending}
                  onClick={stop}
                >
                  <Square size={11} fill="currentColor" />
                  <span>
                    {task?.status === 'stopping'
                      ? '停止中'
                      : task?.status === 'unconfirmed'
                        ? '再次确认停止'
                        : '停止'}
                  </span>
                </button>
              )}
              <button
                className="agent-primary"
                aria-label={running ? '补充要求' : '发送'}
                disabled={!canSend}
                onClick={() => void submit()}
              >
                {running ? <span>补充要求</span> : <Send size={14} />}
                {!running && <span>发送</span>}
              </button>
              {running && (
                <div className="agent-anchor">
                  <button
                    className="agent-icon-button"
                    aria-label="其他发送方式"
                    aria-haspopup="dialog"
                    aria-expanded={menu === 'send'}
                    onClick={() => toggleMenu('send')}
                  >
                    <ChevronDown size={12} />
                  </button>
                  {menu === 'send' && (
                    <Popover label="发送方式" align="right" onClose={closeMenu}>
                      <button
                        className="agent-menu-item"
                        disabled={!canSend}
                        onClick={() => void submit('followUp')}
                      >
                        本轮结束后发送<span>⌘ / Ctrl + Shift + Enter</span>
                      </button>
                    </Popover>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="agent-input-hint">
          {submitting
            ? '正在提交…'
            : locked
              ? '等待执行确认后可发送'
              : running
                ? 'Enter 补充要求 · Shift + Enter 换行'
                : 'Enter 发送 · Shift + Enter 换行'}
        </p>
      </footer>
      {floating && <ResizeHandles onStart={startResize} />}
    </div>
  );
}

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
