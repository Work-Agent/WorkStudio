/**
 * AI 助手视图（独立渲染进程）—— S4，主进程事实的投影。
 *
 * 形态（architecture.md §13.4）：
 *   停靠 = 单排 tabs（tabs 右端：浮动 / 新会话），无独立标题行；
 *   浮动 = 拖拽标题栏 + 同一排 tabs；移动/缩放交主进程交互层。
 * 会话标签集合语义（打开/关闭/激活）在主进程（session.openTab / closeTabs）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brain,
  ChevronDown,
  GripHorizontal,
  Maximize2,
  MessageCirclePlus,
  Minimize2,
  MoveDiagonal2,
  PanelRight,
  PictureInPicture2,
  Send,
  Square,
  X,
} from 'lucide-react';
import type {
  AgentSnapshot,
  ParsedBlock,
  ResizeDirection,
  ParsedMessage,
  PiEventFrame,
  SessionMeta,
  ShellSnapshot,
  ThinkingLevel,
  UiState,
} from '../../shared/types';
import '../index.css';

const bridge = window.assistant;

// 浮动圆角依赖视图透明：页面画布与 body 不得有底色（面板底色由根容器负责）。
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
const MENU_SOURCE = 'chat-tabs';

// ─── 事实订阅 ─────────────────────────────────────────────

function useShell(): ShellSnapshot | null {
  const [shell, setShell] = useState<ShellSnapshot | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const off = bridge.onState(setShell);
    void bridge.sync().then((r) => setShell(r.shell));
    return off;
  }, []);
  return shell;
}

function useAgent(): AgentSnapshot | null {
  const [agent, setAgent] = useState<AgentSnapshot | null>(null);
  useEffect(() => {
    if (!bridge) return;
    void bridge.sync().then((r) => setAgent(r.agent));
    const off = bridge.onEvent((frame: PiEventFrame) => {
      const ev = frame.event as { type: string; status?: AgentSnapshot };
      if (ev.type === 'agent_status_changed' && ev.status) setAgent(ev.status);
      if (ev.type === 'agent_settled') {
        void bridge
          .cmd<AgentSnapshot>('agent.status')
          .then((r) => r.ok && setAgent(r.data));
      }
    });
    return off;
  }, []);
  return agent;
}

/** 全部会话（标签显示名 + 新会话命名）；事件驱动刷新。 */
function useSessions(openPaths: string[]): SessionMeta[] {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const reload = (): void => {
    void bridge
      ?.cmd<SessionMeta[]>('session.list')
      .then((r) => r.ok && setSessions(r.data));
  };
  useEffect(() => {
    reload();
    if (!bridge) return;
    const off = bridge.onEvent((frame) => {
      const type = (frame.event as { type: string }).type;
      if (
        type === 'session_created' ||
        type === 'session_rebound' ||
        type === 'agent_settled'
      )
        reload();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(reload, [openPaths.join('|')]);
  return sessions;
}

// ─── 消息流投影（按会话隔离） ─────────────────────────────

/** 消息文本提取（用户回显 / 乐观清理用）。 */
function messageTextOf(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => (b as { type?: string }).type === 'text')
    .map((b) => String((b as { text?: string }).text ?? ''))
    .join('\n');
}

/** 已解析消息的文本（去重用）。 */
function parsedTextOf(message: ParsedMessage): string {
  return message.blocks
    .map((b) => (b.type === 'text' || b.type === 'thinking' ? b.text : ''))
    .join('');
}

function useMessages(activePath: string | null): {
  messages: ParsedMessage[];
  streaming: boolean;
  optimistic: string | undefined;
  pushOptimistic: (text: string) => void;
  clearNewTask: () => void;
} {
  const [byPath, setByPath] = useState<Record<string, ParsedMessage[]>>({});
  const [optimisticByKey, setOptimisticByKey] = useState<
    Record<string, string>
  >({});
  const [streaming, setStreaming] = useState(false);
  /** 当前会话身份（事件优先更新，不等 ui-state 广播；展示与消息归属共用）。 */
  const [currentPath, setCurrentPath] = useState<string | null>(activePath);
  const currentPathRef = useRef<string | null>(activePath);
  /** 已发出、等待用户消息事件落地的乐观发送（避免 rebound 误清新任务桶）。 */
  const pendingSendRef = useRef(false);
  /** 已接收实时事件的桶（历史加载不得覆盖流式中的消息）。 */
  const liveKeys = useRef(new Set<string>());

  const setPath = (path: string | null): void => {
    currentPathRef.current = path;
    setCurrentPath(path);
  };

  // ui-state 抖动兜底（事件先到；这里只在两者不一致时对齐）
  useEffect(() => {
    if (activePath !== currentPathRef.current) setPath(activePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // 会话历史懒加载（流式中到达的历史只拼前缀，不覆盖实时消息）
  useEffect(() => {
    const key = activePath ?? '__new__';
    if (!activePath || byPath[key]) return;
    void bridge
      ?.cmd<ParsedMessage[]>('session.getMessages', { path: activePath })
      .then((r) => {
        if (!r.ok) return;
        setByPath((prev) => {
          const live = prev[key];
          if (!liveKeys.current.has(key) || !live || live.length === 0)
            return { ...prev, [key]: r.data };
          // 已流式写入 → 历史拼在现有消息之前（仅去重首条重复的用户消息）
          const history = r.data;
          const last = history[history.length - 1];
          const first = live[0];
          const duplicatedUser =
            last?.role === 'user' &&
            first?.role === 'user' &&
            parsedTextOf(last) === parsedTextOf(first);
          return {
            ...prev,
            [key]: duplicatedUser
              ? [...history, ...live.slice(1)]
              : [...history, ...live],
          };
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  useEffect(() => {
    if (!bridge) return;
    const patchLast = (
      mutate: (blocks: ParsedBlock[]) => ParsedBlock[],
    ): void => {
      const key = currentPathRef.current ?? '__new__';
      liveKeys.current.add(key);
      setByPath((prev) => {
        const list = [...(prev[key] ?? [])];
        const last = list[list.length - 1];
        if (last?.role === 'assistant') {
          list[list.length - 1] = {
            role: 'assistant',
            blocks: mutate([...last.blocks]),
          };
        } else {
          // 上一条是用户消息（或其他）→ 追加新的助手消息，绝不覆盖
          list.push({ role: 'assistant', blocks: mutate([]) });
        }
        return { ...prev, [key]: list };
      });
    };
    const appendDelta = (type: 'text' | 'thinking', delta: string): void =>
      patchLast((blocks) => {
        const last = blocks[blocks.length - 1];
        if (last && last.type === type) {
          blocks[blocks.length - 1] = { type: type, text: last.text + delta };
        } else {
          blocks.push({ type: type, text: delta });
        }
        return blocks;
      });
    /** 用户消息落地（事件为权威；乐观气泡同时撤下）。 */
    const appendUser = (text: string): void => {
      const key = currentPathRef.current ?? '__new__';
      liveKeys.current.add(key);
      setByPath((prev) => {
        const list = [...(prev[key] ?? [])];
        const last = list[list.length - 1];
        if (last?.role === 'user') {
          const lastText = last.blocks
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('');
          if (lastText === text) return prev;
        }
        list.push({ role: 'user', blocks: [{ type: 'text', text }] });
        return { ...prev, [key]: list };
      });
      setOptimisticByKey((prev) => {
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };

    /** 新一段助手消息占位（一次 turn 里 pi 会发多段 assistant message，各自成条）。 */
    const startAssistant = (): void => {
      const key = currentPathRef.current ?? '__new__';
      liveKeys.current.add(key);
      setByPath((prev) => {
        const list = [...(prev[key] ?? [])];
        const last = list[list.length - 1];
        if (last?.role === 'assistant' && last.blocks.length === 0) return prev;
        list.push({ role: 'assistant', blocks: [] });
        return { ...prev, [key]: list };
      });
    };

    /**
     * message_end 对账：合帧会丢中间 delta，渲染层必须用权威 content 重建块；
     * 工具卡的执行结果按 toolCallId 保留（不丢已到达的 tool_execution_end）。
     */
    const reconcileAssistant = (content: unknown): void => {
      const key = currentPathRef.current ?? '__new__';
      liveKeys.current.add(key);
      const parts = Array.isArray(content)
        ? (content as Array<Record<string, unknown>>)
        : [];
      setByPath((prev) => {
        const list = [...(prev[key] ?? [])];
        const idx = list.length - 1;
        const target = list[idx];
        if (!target || target.role !== 'assistant') return prev;
        const existing = target.blocks;
        const toolById = new Map(
          existing
            .filter(
              (b): b is Extract<ParsedBlock, { type: 'tool' }> =>
                b.type === 'tool',
            )
            .map((b) => [b.toolCallId, b] as const),
        );
        const next: ParsedBlock[] = [];
        for (const part of parts) {
          if (
            part['type'] === 'text' &&
            typeof part['text'] === 'string' &&
            part['text']
          ) {
            next.push({ type: 'text', text: part['text'] });
          } else if (
            part['type'] === 'thinking' &&
            typeof part['thinking'] === 'string' &&
            part['thinking']
          ) {
            next.push({ type: 'thinking', text: part['thinking'] });
          } else if (part['type'] === 'toolCall') {
            const id = String(part['id'] ?? '');
            next.push(
              toolById.get(id) ?? {
                type: 'tool',
                toolCallId: id,
                toolName: String(part['name'] ?? 'tool'),
                args: part['arguments'] ?? {},
                result: '',
              },
            );
          }
        }
        // content 未覆盖的已有工具卡保留（不丢卡片）
        for (const [id, block] of toolById) {
          if (!next.some((b) => b.type === 'tool' && b.toolCallId === id))
            next.push(block);
        }
        list[idx] = { role: 'assistant', blocks: next };
        return { ...prev, [key]: list };
      });
    };

    /** 终态清理：尾部空助手占位（abort / 空响应）不展示。 */
    const dropEmptyTrailing = (): void => {
      const key = currentPathRef.current ?? '__new__';
      setByPath((prev) => {
        const list = [...(prev[key] ?? [])];
        let changed = false;
        while (list.length > 0) {
          const last = list[list.length - 1];
          if (last?.role === 'assistant' && last.blocks.length === 0) {
            list.pop();
            changed = true;
          } else {
            break;
          }
        }
        return changed ? { ...prev, [key]: list } : prev;
      });
    };
    /** 丢弃未落库的新任务草稿（切换 / 显式新建后不再展示）。 */
    const dropNewTask = (): void => {
      setByPath((prev) => {
        if (!prev['__new__']) return prev;
        const next = { ...prev };
        delete next['__new__'];
        return next;
      });
      setOptimisticByKey((prev) => {
        if (prev['__new__'] === undefined) return prev;
        const next = { ...prev };
        delete next['__new__'];
        return next;
      });
      setStreaming(false);
    };

    const off = bridge.onEvent((frame: PiEventFrame) => {
      const ev = frame.event as Record<string, unknown> & { type: string };
      switch (ev.type) {
        case 'session_created': {
          const path = String(ev.sessionPath ?? '');
          if (!path) break;
          // 新任务草稿迁移到真实会话文件
          setByPath((prev) => {
            const next = {
              ...prev,
              [path]: prev['__new__'] ?? prev[path] ?? [],
            };
            delete next['__new__'];
            return next;
          });
          setOptimisticByKey((prev) => {
            if (prev['__new__'] === undefined) return prev;
            const next = { ...prev, [path]: prev['__new__'] };
            delete next['__new__'];
            return next;
          });
          setPath(path);
          break;
        }
        case 'session_rebound': {
          const file = String(ev.sessionFile ?? '');
          const reason = String(ev.reason ?? '');
          setPath(file || null);
          // 非发送中的换代（新建 / 切换 / 工作区）→ 新任务草稿作废
          if (
            !pendingSendRef.current &&
            (reason === 'new' || reason === 'switch' || reason === 'workspace')
          )
            dropNewTask();
          break;
        }
        case 'message_start': {
          const message = ev.message as { role?: string } | undefined;
          if (message?.role === 'assistant') startAssistant();
          setStreaming(true);
          break;
        }
        case 'message_end': {
          const message = ev.message as
            | { role?: string; content?: unknown }
            | undefined;
          if (message?.role === 'user') {
            const text = messageTextOf(message);
            if (text) appendUser(text);
            pendingSendRef.current = false;
          } else if (message?.role === 'assistant') {
            reconcileAssistant(message.content);
          }
          break;
        }
        case 'message_update': {
          const inner = ev.assistantMessageEvent as
            | { type?: string; delta?: string }
            | undefined;
          if (inner?.type === 'text_delta' && inner.delta)
            appendDelta('text', inner.delta);
          if (inner?.type === 'thinking_delta' && inner.delta)
            appendDelta('thinking', inner.delta);
          break;
        }
        case 'tool_execution_start': {
          patchLast((blocks) => {
            blocks.push({
              type: 'tool',
              toolCallId: String(ev.toolCallId ?? ''),
              toolName: String(ev.toolName ?? 'tool'),
              args: ev.args ?? {},
              result: '',
            });
            return blocks;
          });
          break;
        }
        case 'tool_execution_end': {
          const key = currentPathRef.current ?? '__new__';
          setByPath((prev) => ({
            ...prev,
            [key]: (prev[key] ?? []).map((m) => ({
              ...m,
              blocks: m.blocks.map((b) =>
                b.type === 'tool' && b.toolCallId === String(ev.toolCallId)
                  ? { ...b, result: stringify(ev.result) }
                  : b,
              ),
            })),
          }));
          break;
        }
        case 'agent_settled':
        case 'agent_end':
          setStreaming(false);
          pendingSendRef.current = false;
          dropEmptyTrailing();
          break;
        case 'error':
          setStreaming(false);
          pendingSendRef.current = false;
          dropEmptyTrailing();
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  const displayKey = currentPath ?? '__new__';
  return {
    messages: byPath[displayKey] ?? [],
    streaming,
    optimistic: optimisticByKey[displayKey],
    pushOptimistic: (text) => {
      pendingSendRef.current = true;
      const key = currentPathRef.current ?? '__new__';
      setOptimisticByKey((prev) => ({ ...prev, [key]: text }));
    },
    clearNewTask: () => {
      setByPath((prev) => {
        if (!prev['__new__']) return prev;
        const next = { ...prev };
        delete next['__new__'];
        return next;
      });
      setOptimisticByKey((prev) => {
        if (prev['__new__'] === undefined) return prev;
        const next = { ...prev };
        delete next['__new__'];
        return next;
      });
      setStreaming(false);
    },
  };
}

function stringify(value: unknown): string {
  if (value == null) return '';
  try {
    const content = (
      value as { content?: Array<{ type: string; text?: string }> }
    ).content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
    }
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return String(value);
  }
}

function tabLabel(sessions: SessionMeta[], path: string): string {
  const name = sessions.find((s) => s.path === path)?.name;
  if (name) return name;
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.jsonl?$/i, '').slice(0, 24) || '会话';
}

/** token 简写（↑/↓ 状态行）。 */
function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

// ─── 页面 ─────────────────────────────────────────────────

interface PopupItem {
  id: string;
  label: string;
  disabled?: boolean;
}

function Assistant() {
  const shell = useShell();
  const agent = useAgent();
  const ui: UiState | undefined = shell?.ui;
  const activePath = ui?.activePath ?? null;
  const openPaths = ui?.openPaths ?? [];
  const sessions = useSessions(openPaths);
  const {
    messages,
    streaming,
    optimistic: optimisticText,
    pushOptimistic,
    clearNewTask,
  } = useMessages(activePath);
  const floating = ui?.aiFloating ?? false;
  const inputExpanded = ui?.inputExpanded ?? false;
  const activeTokens = sessions.find((s) => s.path === activePath)?.tokens;

  const [text, setText] = useState('');
  const [models, setModels] = useState<
    Array<{ provider: string; modelId: string; label: string }>
  >([]);
  const [thinkingLevels, setThinkingLevels] = useState<ThinkingLevel[]>([]);
  const [menu, setMenu] = useState<'model' | 'thinking' | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    void bridge?.cmd('agent.models').then((r) => {
      if (r.ok) setModels((r.data as typeof models) ?? []);
    });
    void bridge?.cmd('agent.thinkingLevels').then((r) => {
      if (r.ok) setThinkingLevels((r.data as ThinkingLevel[]) ?? []);
    });
  }, [agent?.provider, agent?.modelId]);

  // 自动滚动：距底 <80px 才跟随
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollRef.current) return;
    queueMicrotask(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, messages.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ── tab 右键菜单（原生 Menu.popup；关闭族语义与资源面板一致）──
  useEffect(() => {
    if (!bridge) return;
    return bridge.onPopupSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      const [action, path] = e.actionId.split(':');
      const state = openPaths;
      const close = (paths: string[]): void => {
        void bridge?.cmd('session.closeTabs', { paths });
      };
      if (action === 'close' && path) close([path]);
      else if (action === 'closeOthers' && path)
        close(state.filter((p) => p !== path));
      else if (action === 'closeLeft' && path)
        close(state.slice(0, state.indexOf(path)));
      else if (action === 'closeRight' && path)
        close(state.slice(state.indexOf(path) + 1));
      else if (action === 'closeAll') close([...state]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPaths.join('|')]);

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
    void bridge?.shell.showPopup({ source: MENU_SOURCE, items });
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (!value || !bridge) return;
    setText('');
    // 乐观气泡（用户消息事件到达时自动撤下）
    pushOptimistic(value);
    await bridge.cmd('session.prompt', {
      text: value,
      newSession: !activePath,
      activeSkills: ui?.selectedSkills ?? [],
    });
  };

  const [dragging, setDragging] = useState(false);

  // 发起方拥有完整的拖拽序列（pointerdown 命中的视图会持续收到 move/up）：
  // 主进程几何更新仍以 screen 光标为准，这里只负责“按键仍按下”的节流上报与收尾。
  useEffect(() => {
    if (!dragging || !bridge) return;
    // 发起方拥有拖拽序列（OS 语义：pointerdown 命中的视图持续收到 move/up）；
    // 这里不做按键过滤（不同平台/事件的 buttons 位不可靠），只上报“仍在拖”。
    const onMove = (): void => {
      void bridge.interaction.move();
    };
    const stop = (): void => {
      setDragging(false);
      void bridge.interaction.end();
    };
    // 注意：不要监听 window blur —— 交互开始后捕获层会抢焦点，blur 是正常现象；
    // 真正的“焦点离开整个窗口”由主进程 win.on('blur') 兜底。
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('mouseup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
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

  const setUi = (patch: Partial<UiState>): void => {
    void bridge?.cmd('ui.set', { patch });
  };

  const currentModel = useMemo(
    () =>
      models.find(
        (m) => m.provider === agent?.provider && m.modelId === agent?.modelId,
      ),
    [models, agent?.provider, agent?.modelId],
  );

  const canSend = Boolean(agent?.configured) && text.trim().length > 0;
  const showEmpty = messages.length === 0 && !streaming && !optimisticText;

  return (
    <div
      className={`relative h-screen w-full flex flex-col bg-zinc-50 dark:bg-[#202124] text-zinc-900 dark:text-zinc-100 text-[12px] overflow-hidden ${
        floating
          ? 'rounded-xl border border-zinc-300/80 dark:border-zinc-700/80'
          : ''
      }`}
    >
      {/* 会话标签栏（单排；浮动态此排即标题栏：把手/空白处拖拽移动） */}
      <div
        className="h-9 shrink-0 flex items-stretch border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#202124] select-none"
        style={floating ? { cursor: 'move' } : undefined}
        onPointerDown={floating ? startDrag : undefined}
      >
        {floating && (
          <div
            className="shrink-0 flex items-center pl-2 pr-1 text-zinc-400"
            title="拖动以移动"
          >
            <GripHorizontal className="w-3.5 h-3.5" />
          </div>
        )}
        <div className="flex flex-1 items-stretch overflow-x-auto min-w-0 tab-scroll">
          {openPaths.map((path) => {
            const isActive = path === activePath;
            const isStreaming = isActive && (streaming || agent?.isStreaming);
            return (
              <div
                key={path}
                data-no-drag
                onClick={() => void bridge?.cmd('session.openTab', { path })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openTabMenu(path);
                }}
                title={tabLabel(sessions, path)}
                className={`group relative flex items-center justify-center gap-1.5 px-5 shrink-0 cursor-pointer border-r border-zinc-200 dark:border-zinc-800/60 transition-colors max-w-32 min-w-0 ${
                  isActive
                    ? 'bg-white dark:bg-[#262829] text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#252829] hover:text-zinc-700 dark:hover:text-zinc-200'
                }`}
              >
                {isActive && (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-[#4F6BED] rounded-b" />
                )}
                {isStreaming && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#4F6BED] animate-pulse shrink-0"
                    title="正在执行"
                  />
                )}
                <span className="text-[12px] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                  {tabLabel(sessions, path)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void bridge?.cmd('session.closeTabs', { paths: [path] });
                  }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-200 dark:hover:bg-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="关闭标签（数据保留）"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {activePath === null && (
            <div
              data-testid="chat-tab-new"
              className="relative flex items-center justify-center px-5 shrink-0 border-r border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-[#262829] text-zinc-900 dark:text-zinc-100 max-w-32"
              title="新任务（发送后成为独立会话）"
            >
              <span className="absolute inset-x-0 top-0 h-0.5 bg-[#4F6BED] rounded-b" />
              <span className="text-[12px] whitespace-nowrap">新任务</span>
            </div>
          )}
        </div>

        {/* 停止（执行中，标签栏右端常驻） */}
        {(streaming || agent?.isStreaming) && (
          <button
            onClick={() => void bridge?.cmd('session.abort')}
            className="shrink-0 px-2.5 flex items-center border-l border-zinc-200 dark:border-zinc-800 text-red-500 hover:bg-zinc-100 dark:hover:bg-[#252829]"
            title="停止执行"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        )}

        {/* 形态切换：浮动态 → 停靠；停靠态 → 浮动（收起由 TitleBar 💬 负责） */}
        <button
          onClick={() => setUi({ aiFloating: !floating })}
          className="shrink-0 px-2.5 flex items-center border-l border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-300 hover:text-[#4F6BED] dark:hover:text-[#4F6BED] hover:bg-zinc-100 dark:hover:bg-[#252829]"
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
          disabled={!agent?.configured}
          className="shrink-0 px-2.5 flex items-center border-l border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-300 hover:text-[#4F6BED] dark:hover:text-[#4F6BED] hover:bg-zinc-100 dark:hover:bg-[#252829] disabled:opacity-40"
          title={agent?.configured ? '新会话' : '配置模型后可用'}
        >
          <MessageCirclePlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3"
      >
        {showEmpty && agent?.configured && (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-600 gap-2">
            <span className="text-[13px]">描述一个任务开始工作</span>
            <span className="text-[11px]">
              例如：帮我整理 docs 目录下的季度报告
            </span>
          </div>
        )}
        {showEmpty && !agent?.configured && (
          <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-600">
            ⚠ 未配置模型（请在模型设置中配置）
          </div>
        )}
        {messages.map((message, i) => (
          <MessageRow key={i} message={message} />
        ))}
        {optimisticText && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg bg-[#4F6BED] text-white px-2.5 py-1.5 whitespace-pre-wrap">
              {optimisticText}
            </div>
          </div>
        )}
      </div>

      {/* token 状态行（会话 token 统计；与消息流同源） */}
      {activeTokens && (
        <div className="shrink-0 px-3 pt-1 flex justify-end text-[10.5px] text-zinc-400 dark:text-zinc-500">
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
        <div className="border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-[#232627] focus-within:border-zinc-400 dark:focus-within:border-zinc-500 flex flex-col flex-1 min-h-0">
          <div className="relative flex items-start px-2 pt-1.5 flex-1 min-h-0">
            <textarea
              className={`min-w-0 flex-1 resize-none bg-transparent text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none text-[12.5px] leading-normal overflow-y-auto pr-5 ${
                inputExpanded ? 'h-full' : ''
              }`}
              rows={inputExpanded ? undefined : 3}
              placeholder={
                agent?.configured
                  ? '描述要完成的操作…（Enter 发送，Shift+Enter 换行）'
                  : '未配置模型'
              }
              value={text}
              disabled={!agent?.configured}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              onClick={() => setUi({ inputExpanded: !inputExpanded })}
              className="absolute right-1.5 top-1 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] rounded transition-colors"
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
          <div className="flex items-center gap-1 px-2 pb-1 pt-1.5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
            {/* 思考档位 */}
            <div className="relative">
              <button
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e]"
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
                  <div className="absolute bottom-7 left-0 z-50 w-40 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#1E2021] shadow-xl">
                    {(thinkingLevels.length > 0
                      ? thinkingLevels
                      : ([agent?.thinkingLevel ?? 'off'] as ThinkingLevel[])
                    ).map((level) => (
                      <button
                        key={level}
                        className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] ${
                          level === agent?.thinkingLevel
                            ? 'text-[#4F6BED] font-medium'
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

            <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500 truncate">
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
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] max-w-40"
                onClick={() => setMenu(menu === 'model' ? null : 'model')}
                disabled={models.length === 0}
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
                  <div className="absolute bottom-7 right-0 z-50 w-60 max-h-64 overflow-y-auto rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#1E2021] shadow-xl">
                    {models.map((m) => (
                      <button
                        key={`${m.provider}/${m.modelId}`}
                        className={`w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] ${
                          m.provider === agent?.provider &&
                          m.modelId === agent?.modelId
                            ? 'text-[#4F6BED] font-medium'
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
                        <span className="ml-1 text-[10px] text-zinc-400">
                          {m.provider}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 发送 / 停止（图标键，与 Pi-Work 一致） */}
            {streaming || agent?.isStreaming ? (
              <button
                className="p-1 text-red-500 hover:text-red-600 transition-colors"
                onClick={() => void bridge?.cmd('session.abort')}
                title="停止生成（Esc）"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                className="p-1 text-[#4F6BED] hover:text-[#3D56E0] disabled:opacity-40 transition-colors"
                disabled={!canSend || !bridge}
                onClick={() => void send()}
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
function ResizeHandles({
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

function MessageRow({ message }: { message: ParsedMessage }) {
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
