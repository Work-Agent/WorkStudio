/**
 * 助手视图的数据投影：壳层快照、Agent 状态、会话列表与消息流。
 *
 * 主进程是事实源；这里只做 AppSnapshot / AppEvent → React 状态的投影。
 */
import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot } from '../../shared/app';
import type {
  AgentSnapshot,
  ParsedBlock,
  ParsedMessage,
  SessionMeta,
} from '../../shared/types';
import { bridge } from './bridge';

// ─── 事实订阅 ─────────────────────────────────────────────

interface AssistantShell {
  ui: {
    theme: 'light' | 'dark';
    aiFloating: boolean;
    inputExpanded: boolean;
    activePath: string | null;
    openPaths: string[];
    selectedSkills: string[];
  };
}

function shellFrom(snapshot: AppSnapshot): AssistantShell {
  return {
    ui: {
      theme: snapshot.ui.theme,
      aiFloating: snapshot.ui.assistant.floating,
      inputExpanded: snapshot.ui.assistant.inputExpanded,
      activePath: snapshot.session.meta?.path ?? null,
      openPaths: snapshot.ui.openSessionPaths,
      selectedSkills: snapshot.session.context.activeSkills,
    },
  };
}

export function useShell(): AssistantShell | null {
  const [shell, setShell] = useState<AssistantShell | null>(null);
  useEffect(() => {
    if (!bridge) return;
    void bridge.appSync().then((snapshot) => setShell(shellFrom(snapshot)));
    const off = bridge.onAppSnapshot((snapshot) =>
      setShell(shellFrom(snapshot)),
    );
    return off;
  }, []);
  return shell;
}

export function useAgent(): AgentSnapshot | null {
  const [agent, setAgent] = useState<AgentSnapshot | null>(null);
  useEffect(() => {
    const api = bridge;
    if (!api) return;
    void api.appSync().then((snapshot) => setAgent(snapshot.session.snapshot));
    const off = api.onAppEvent((event) => {
      if (event.scope !== 'session') return;
      const ev = event.event as { type: string; status?: AgentSnapshot };
      if (ev.type === 'agent_status_changed' && ev.status) setAgent(ev.status);
      if (ev.type === 'agent_settled') {
        void api
          .cmd<AgentSnapshot>('agent.status')
          .then((r) => r.ok && setAgent(r.data));
      }
    });
    return off;
  }, []);
  return agent;
}

/** 全部会话（标签显示名 + 新会话命名）；事件驱动刷新。 */
export function useSessions(openPaths: string[]): SessionMeta[] {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .appSync()
      .then((snapshot) => setSessions(snapshot.workspace.sessions));
    const off = bridge.onAppSnapshot((snapshot) =>
      setSessions(snapshot.workspace.sessions),
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPaths.join('|')]);
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

export function useMessages(activePath: string | null): {
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

    const off = bridge.onAppEvent((appEvent) => {
      if (appEvent.scope !== 'session') return;
      const ev = appEvent.event as Record<string, unknown> & { type: string };
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
