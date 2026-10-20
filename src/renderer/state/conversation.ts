/**
 * 会话域 store（zustand）—— EventReducer（pi:event 官方事件流 → 视图模型）。
 *
 * 数据面：
 *   message_start/update/end      → 流式消息生命周期（乐观 user 去重）
 *   tool_execution_start/end      → 工具卡状态机
 *   agent_settled                 → 会话级完成（streaming flag + FSM 终态）
 *   session_created/rebound       → workbench 内部事件族（路由键迁移）
 *
 * 事件路由键：piSessionFile（当前 runtime 会话身份）——单会话宿主语义
 * （tab 切换 = switch_session 换代）。
 */
import { create } from 'zustand';
import type { PiEventFrame, SessionMeta } from '../../shared/types';
import { piAPI } from '../api/bridge';
import { useAgentConfigStore } from './agentConfig';
import { eventBus } from './eventBus';
import { createMachine, type Machine } from './machine';
import {
  type ChatMessage,
  type ContentBlock,
  EMPTY_MESSAGES,
  parseParsedMessages,
  uid,
} from './message';
import { useUiStore, setUiState } from './uiState';

/** 主进程桥（新架构）；存在时全线走 `session.*` 命令，mock 路径仅供独立页面开发。 */
const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

type CmdResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** 命令调用（新桥 `session.*` / 旧 mock 命令名双轨）。 */
async function run<T>(
  bridgeCommand: string,
  legacyCommand: string,
  params?: unknown,
): Promise<CmdResult<T>> {
  if (mainBridge) {
    const r = await mainBridge.cmd<T>(bridgeCommand, params);
    return r.ok
      ? { ok: true, data: r.data }
      : { ok: false, error: r.error.message };
  }
  const r = await piAPI.cmd.invoke<T>(legacyCommand, params);
  return r.ok
    ? { ok: true, data: r.data }
    : { ok: false, error: String(r.error) };
}

export type Tokens = { input: number; output: number };
const ZERO_TOKENS: Tokens = { input: 0, output: 0 };

/** pi 队列模式：steer 修正当前执行 / followUp 排队下一轮。 */
export type QueueMode = 'steer' | 'followUp';

// ─── PromptFSM（当前执行流） ───────────────────────────────

type PromptState =
  | 'draft'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'error'
  | 'aborted';
type PromptEvent =
  | 'SEND'
  | 'SESSION_CREATED'
  | 'DELTA'
  | 'DONE'
  | 'ERROR'
  | 'ABORT'
  | 'RESET';

const PROMPT_TRANSITIONS: Record<string, PromptState> = {
  'draft:SEND': 'sending',
  'sending:SESSION_CREATED': 'streaming',
  'sending:DELTA': 'streaming',
  'sending:DONE': 'done',
  'sending:ERROR': 'error',
  'streaming:DELTA': 'streaming',
  'streaming:DONE': 'done',
  'streaming:ERROR': 'error',
  'streaming:ABORT': 'aborted',
  'sending:ABORT': 'aborted',
  'done:RESET': 'draft',
  'error:RESET': 'draft',
  'aborted:RESET': 'draft',
};

/** PromptFSM 按 key（会话路径或 __new__）多实例：每个打开的会话一条独立执行流。 */
const promptFsms = new Map<string, Machine<PromptState, PromptEvent>>();

function promptFsmFor(key: string): Machine<PromptState, PromptEvent> {
  let fsm = promptFsms.get(key);
  if (!fsm) {
    fsm = createMachine<PromptState, PromptEvent>({
      id: `prompt:${key.slice(-8)}`,
      initial: 'draft',
      transitions: PROMPT_TRANSITIONS,
      onEnter: {
        streaming: () =>
          eventBus.emit({ type: 'session:streaming', path: key }),
        done: () => eventBus.emit({ type: 'session:done', path: key }),
        error: () =>
          eventBus.emit({ type: 'session:error', path: key, message: '' }),
      },
    });
    promptFsms.set(key, fsm);
  }
  return fsm;
}

// ─── 模块级瞬时状态 ────────────────────────────────────────

/** streaming 集合镜像（Set 判定 + 不可变替换给 React 订阅）。 */
const streamingKeys = new Set<string>();
/** 已加载过历史的会话（懒加载缓存标记）。 */
const loaded = new Set<string>();
/** 乐观发送回显队列：send() 已写用户消息，等 pi 的 message_start(user) 回显时消费掉。 */
const pendingUserEcho: string[] = [];
/** 近期已渲染的用户消息（回放/重放去重；窗口内同文本视为回声）。 */
const recentUserAppends = new Map<
  string,
  Array<{ text: string; at: number }>
>();
const USER_DEDUPE_WINDOW_MS = 60_000;

/** 最近收到的事件序号（缺口检测 → pi:sync 重建）。 */
let lastSeq = 0;

// ─── 消息块操作（EventReducer 的 store 侧投影） ─────────────

function appendMessage(key: string, msg: ChatMessage): void {
  useConversationStore.setState((s) => ({
    messagesBySession: {
      ...s.messagesBySession,
      [key]: [...(s.messagesBySession[key] ?? []), msg],
    },
  }));
}

/** 确保末尾存在流式 assistant 消息（乐观更新或 message_start 到达时）。 */
function ensureStreamingAssistant(key: string): void {
  const msgs = useConversationStore.getState().messagesBySession[key] ?? [];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'assistant' || !last.streaming) {
    appendMessage(key, {
      id: uid(),
      role: 'assistant',
      blocks: [],
      streaming: true,
    });
  }
}

function mutateLastAssistant(
  key: string,
  fn: (blocks: ContentBlock[]) => ContentBlock[],
  streaming?: boolean,
): void {
  useConversationStore.setState((s) => {
    const msgs = [...(s.messagesBySession[key] ?? [])];
    let last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') {
      last = { id: uid(), role: 'assistant', blocks: [], streaming: true };
      msgs.push(last);
    }
    msgs[msgs.length - 1] = {
      ...last,
      blocks: fn(last.blocks),
      streaming: streaming !== undefined ? streaming : last.streaming,
    };
    return { messagesBySession: { ...s.messagesBySession, [key]: msgs } };
  });
}

function appendDelta(
  key: string,
  kind: 'text' | 'thinking',
  delta: string,
): void {
  mutateLastAssistant(key, (blocks) => {
    const next = [...blocks];
    const lastBlock = next[next.length - 1];
    if (lastBlock?.type === kind)
      next[next.length - 1] = { type: kind, text: lastBlock.text + delta };
    else next.push({ type: kind, text: delta });
    return next;
  });
}

function pushToolBlock(
  key: string,
  toolCall: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    status: 'running' | 'done' | 'error';
    result?: string;
  },
): void {
  mutateLastAssistant(key, (blocks) => {
    // 同 id 已存在（reconcile 从 message.content 预建）→ 就地更新，不重复建卡
    const idx = blocks.findIndex(
      (b) => b.type === 'tool' && b.toolCall.toolCallId === toolCall.toolCallId,
    );
    if (idx >= 0) {
      const next = [...blocks];
      const prev = next[idx];
      if (prev.type === 'tool')
        next[idx] = {
          type: 'tool',
          toolCall: { ...prev.toolCall, ...toolCall },
        };
      return next;
    }
    return [...blocks, { type: 'tool', toolCall }];
  });
}

function updateToolBlock(
  key: string,
  toolCallId: string,
  status: 'done' | 'error',
  result: string,
): void {
  mutateLastAssistant(key, (blocks) =>
    blocks.map((b) =>
      b.type === 'tool' && b.toolCall.toolCallId === toolCallId
        ? { type: 'tool' as const, toolCall: { ...b.toolCall, status, result } }
        : b,
    ),
  );
}

/** 终态兜底：settled 后仍 running 的工具卡收敛为 error，避免永久 spinner。 */
function settleRunningTools(key: string): void {
  useConversationStore.setState((s) => {
    const msgs = s.messagesBySession[key] ?? [];
    let changed = false;
    const updated = msgs.map((m) => {
      if (m.role !== 'assistant') return m;
      let msgChanged = false;
      const blocks = m.blocks.map((b) => {
        if (b.type === 'tool' && b.toolCall.status === 'running') {
          msgChanged = true;
          return {
            type: 'tool' as const,
            toolCall: {
              ...b.toolCall,
              status: 'error' as const,
              result: '（未收到执行结果）',
            },
          };
        }
        return b;
      });
      if (!msgChanged) return m;
      changed = true;
      return { ...m, blocks };
    });
    if (!changed) return s;
    return { messagesBySession: { ...s.messagesBySession, [key]: updated } };
  });
}

/** 清理空 streaming 占位（0 块 + streaming）——settled 后仍存在的必是事件缺口产物。 */
function dropEmptyPlaceholders(): void {
  useConversationStore.setState((s) => {
    let changed = false;
    const next = { ...s.messagesBySession };
    for (const [key, msgs] of Object.entries(s.messagesBySession)) {
      const kept = msgs.filter(
        (m) =>
          !(
            m.role === 'assistant' &&
            m.streaming === true &&
            m.blocks.length === 0
          ),
      );
      if (kept.length === msgs.length) continue;
      changed = true;
      next[key] = kept;
    }
    return changed ? { messagesBySession: next } : s;
  });
}

function finalizeLastAssistant(key: string): void {
  mutateLastAssistant(key, (blocks) => blocks, false);
}

/** message_end 权威对齐：用最终 message.content 重建 text/thinking 块。 */
function reconcileAssistant(key: string, message: { content?: unknown }): void {
  const content = Array.isArray(message.content)
    ? (message.content as Array<Record<string, unknown>>)
    : [];
  if (content.length === 0) {
    finalizeLastAssistant(key);
    return;
  }
  mutateLastAssistant(
    key,
    (blocks) => {
      const existingTools = new Map(
        blocks
          .filter((b) => b.type === 'tool')
          .map((b) => [b.toolCall.toolCallId, b.toolCall] as const),
      );
      const next: ContentBlock[] = [];
      for (const part of content) {
        if (
          part.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.length > 0
        ) {
          next.push({ type: 'text', text: part.text });
        } else if (
          part.type === 'thinking' &&
          typeof part.thinking === 'string' &&
          part.thinking.length > 0
        ) {
          next.push({ type: 'thinking', text: part.thinking });
        } else if (part.type === 'toolCall') {
          const id = String(part.id ?? '');
          const prev = existingTools.get(id);
          next.push({
            type: 'tool',
            toolCall: prev ?? {
              toolCallId: id,
              toolName: String(part.name ?? 'tool'),
              args: part.arguments,
              status: 'running' as const,
            },
          });
        }
      }
      // 异常 shape 兜底：已有工具块未出现在 content → 保留（不丢卡片）
      for (const [id, tc] of existingTools) {
        if (
          !next.some((b) => b.type === 'tool' && b.toolCall.toolCallId === id)
        )
          next.push({ type: 'tool', toolCall: tc });
      }
      return next.length > 0 ? next : blocks;
    },
    false,
  );
}

function writeErrorToLast(key: string, message: string): void {
  useConversationStore.setState((s) => {
    const msgs = [...(s.messagesBySession[key] ?? [])];
    const last = msgs[msgs.length - 1];
    if (last?.role === 'assistant') {
      msgs[msgs.length - 1] = { ...last, error: message, streaming: false };
      return { messagesBySession: { ...s.messagesBySession, [key]: msgs } };
    }
    return s;
  });
}

/** 工具结果序列化。 */
function stringifyToolResult(result: unknown): string {
  if (result == null) return '';
  try {
    const content = (
      result as { content?: Array<{ type: string; text?: string }> }
    ).content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text!)
        .join('\n');
    }
  } catch {
    /* fallthrough */
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** 记录一次用户消息渲染（乐观或事件路径都记，供后来的回放去重）。 */
function noteUserAppend(key: string, text: string): void {
  if (!text) return;
  const now = Date.now();
  const list = (recentUserAppends.get(key) ?? []).filter(
    (r) => now - r.at < USER_DEDUPE_WINDOW_MS,
  );
  list.push({ text, at: now });
  recentUserAppends.set(key, list);
}

/** 该会话近期是否已渲染过同文本用户消息（回声判定）。 */
function wasUserAppendedRecently(key: string, text: string): boolean {
  const now = Date.now();
  return (recentUserAppends.get(key) ?? []).some(
    (r) => r.text === text && now - r.at < USER_DEDUPE_WINDOW_MS,
  );
}

/** settled 完成动画窗口（1.5s）。 */
const settledTimers = new Map<string, ReturnType<typeof setTimeout>>();
function flashSettled(path: string): void {
  if (!path) return;
  if (!settledTimers.has(path)) {
    settledTimers.set(
      path,
      setTimeout(() => {
        settledTimers.delete(path);
        useConversationStore.setState((s) => {
          const next = new Set(s.settledFlash);
          next.delete(path);
          return { settledFlash: next };
        });
      }, 1500),
    );
  }
  useConversationStore.setState((s) => ({
    settledFlash: new Set(s.settledFlash).add(path),
  }));
}

// ─── store ────────────────────────────────────────────────

interface ConversationState {
  sessions: SessionMeta[];
  /** 会话路径 → 域（会话列表按域归档的数据面）。 */
  sessionDomains: Record<string, string>;
  messagesBySession: Record<string, ChatMessage[]>;
  tokensBySession: Record<string, Tokens>;
  streamingSessions: Set<string>;
  settledFlash: Set<string>;
  /** 当前 runtime 会话身份（事件路由键；session_created/rebound 维护）。 */
  piSessionFile: string | null;
  /** 思考档位实况（pi:sync 初始化 + thinking_level_changed 维护）。 */
  piThinkingLevel: string | null;
  /** 待发队列（steering/followUp pending）。 */
  piQueue: { steering: string[]; followUp: string[] };

  // 派生访问器
  currentKey: () => string;
  messages: () => ChatMessage[];
  streaming: () => boolean;
  tokens: () => Tokens;

  // 命令
  queueSend: (behavior: QueueMode, text: string) => Promise<void>;
  removeQueueItem: (kind: QueueMode, text: string) => Promise<void>;
  sendNowQueueItem: (kind: QueueMode, text: string) => Promise<void>;
  switchQueueMode: (
    from: QueueMode,
    to: QueueMode,
    text: string,
  ) => Promise<void>;
  clearQueue: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadSession: (path: string) => Promise<void>;
  select: (path: string) => Promise<void>;
  createNew: () => void;
  send: (
    text: string,
    activeSkills?: string[],
    isCommand?: boolean,
  ) => Promise<void>;
  abort: (path: string) => Promise<void>;
  close: (path: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  rename: (path: string, name: string) => Promise<void>;
  setThinkingLevelOptimistic: (level: string) => void;
  handlePiFrame: (frame: PiEventFrame) => void;
  init: () => Promise<void>;
}

export const useConversationStore = create<ConversationState>()((set, get) => ({
  sessions: [],
  sessionDomains: {},
  messagesBySession: {},
  tokensBySession: {},
  streamingSessions: new Set(),
  settledFlash: new Set(),
  piSessionFile: null,
  piThinkingLevel: null,
  piQueue: { steering: [], followUp: [] },

  currentKey: () => useUiStore.getState().activePath ?? '__new__',
  messages: () => get().messagesBySession[get().currentKey()] ?? EMPTY_MESSAGES,
  streaming: () => get().streamingSessions.has(get().currentKey()),
  tokens: () => get().tokensBySession[get().currentKey()] ?? ZERO_TOKENS,

  queueSend: async (behavior, text) => {
    const key = get().currentKey();
    // 乐观入队列（提交即显示 pending，不等事件往返）
    set((s) => ({
      piQueue: {
        steering:
          behavior === 'steer'
            ? [...s.piQueue.steering, text]
            : [...s.piQueue.steering],
        followUp:
          behavior === 'followUp'
            ? [...s.piQueue.followUp, text]
            : [...s.piQueue.followUp],
      },
    }));
    const res = await run<unknown>(
      behavior === 'followUp' ? 'session.followUp' : 'session.steer',
      behavior === 'followUp' ? 'follow_up' : 'steer',
      { text },
    );
    if (!res.ok) {
      // 失败回滚乐观项（queue_update 不会来）
      set((s) => ({
        piQueue: {
          steering:
            behavior === 'steer'
              ? s.piQueue.steering.filter((t) => t !== text)
              : s.piQueue.steering,
          followUp:
            behavior === 'followUp'
              ? s.piQueue.followUp.filter((t) => t !== text)
              : s.piQueue.followUp,
        },
      }));
      writeErrorToLast(key, res.error);
    }
  },

  /** 从 pi 队列移除单条（clear_queue 后回填其余）。 */
  removeQueueItem: async (kind, text) => {
    const arrKey = kind === 'steer' ? 'steering' : 'followUp';
    const rest = get().piQueue[arrKey].filter((t) => t !== text);
    set((s) => ({ piQueue: { ...s.piQueue, [arrKey]: rest } }));
    await run('session.clearQueue', 'clear_queue');
    const command = kind === 'followUp' ? 'session.followUp' : 'session.steer';
    const legacy = kind === 'followUp' ? 'follow_up' : 'steer';
    for (const t of rest) await run(command, legacy, { text: t });
  },

  /** Send Now：出队并立即以指定模式发送。 */
  sendNowQueueItem: async (kind, text) => {
    await get().removeQueueItem(kind, text);
    const res = await run(
      kind === 'followUp' ? 'session.followUp' : 'session.steer',
      kind === 'followUp' ? 'follow_up' : 'steer',
      { text },
    );
    if (!res.ok) writeErrorToLast(get().currentKey(), res.error);
  },

  /** 队列项模式切换（steer↔followUp）：出队旧 mode + 以新 mode 重新入队。 */
  switchQueueMode: async (from, to, text) => {
    if (from === to) return;
    await get().removeQueueItem(from, text);
    await get().queueSend(to, text);
  },

  /** 清空全部队列。 */
  clearQueue: async () => {
    set({ piQueue: { steering: [], followUp: [] } });
    await run('session.clearQueue', 'clear_queue');
  },

  refreshSessions: async () => {
    if (mainBridge) {
      const res = await run<SessionMeta[]>('session.list', 'list_sessions');
      if (res.ok) set({ sessions: res.data, sessionDomains: {} });
      return;
    }
    const [res, domains] = await Promise.all([
      piAPI.cmd.invoke<SessionMeta[]>('list_sessions'),
      piAPI.cmd.invoke<Record<string, string>>('session_domains'),
    ]);
    if (res.ok) set({ sessions: res.data });
    if (domains.ok) set({ sessionDomains: domains.data });
  },

  loadSession: async (path) => {
    if (loaded.has(path)) return;
    loaded.add(path);
    try {
      if (mainBridge) {
        const res = await run<import('../../shared/types').ParsedMessage[]>(
          'session.getMessages',
          'switch_session',
          { path },
        );
        if (!res.ok) throw new Error(res.error);
        const messages = Array.isArray(res.data)
          ? res.data
          : ((
              res.data as unknown as {
                messages: import('../../shared/types').ParsedMessage[];
              }
            ).messages ?? []);
        set((s) => ({
          messagesBySession: {
            ...s.messagesBySession,
            [path]: parseParsedMessages(messages),
          },
          tokensBySession: {
            ...s.tokensBySession,
            [path]: s.tokensBySession[path] ?? ZERO_TOKENS,
          },
        }));
        return;
      }
      const res = await piAPI.cmd.invoke<{
        messages: import('../../shared/types').ParsedMessage[];
        tokens: Tokens;
      }>('switch_session', { path });
      if (!res.ok) throw new Error(res.error);
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [path]: parseParsedMessages(res.data.messages),
        },
        tokensBySession: { ...s.tokensBySession, [path]: res.data.tokens },
      }));
    } catch (e) {
      loaded.delete(path);
      console.error('Failed to load session:', e);
    }
  },

  /** 打开会话：开标签 + 激活 + runtime 换代（switch_session）。 */
  select: async (path) => {
    useUiStore.getState().openSessionTab(path);
    await get().loadSession(path);
  },

  /** 新建任务：activePath=null（新任务态），清 __new__ 草稿。 */
  createNew: () => {
    setUiState({ activePath: null });
    set((s) => {
      const messages = { ...s.messagesBySession };
      const tokens = { ...s.tokensBySession };
      delete messages['__new__'];
      delete tokens['__new__'];
      return { messagesBySession: messages, tokensBySession: tokens };
    });
    loaded.delete('__new__');
    promptFsms.delete('__new__');
  },

  /** 发送消息（PromptFSM 驱动：draft→sending→…；pi:cmd prompt）。 */
  send: async (text, activeSkills, isCommand = false) => {
    const path = useUiStore.getState().activePath;
    const key = path ?? '__new__';
    const fsm = promptFsmFor(key);
    // 终态复位（retry 语义）
    if (fsm.is('done', 'error', 'aborted')) fsm.send('RESET');
    if (!fsm.can('SEND')) return; // 执行流未复位（正在发送）拒绝

    // 乐观更新：用户消息 + 空 assistant 消息；slash 命令不经乐观更新
    if (!isCommand) {
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        blocks: [{ type: 'text', text }],
      };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        blocks: [],
        streaming: true,
      };
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [key]: [...(s.messagesBySession[key] ?? []), userMsg, assistantMsg],
        },
      }));
      pendingUserEcho.push(text);
      noteUserAppend(key, text);
    }
    streamingKeys.add(key);
    set({ streamingSessions: new Set(streamingKeys) });
    fsm.send('SEND');

    const res = await run<unknown>('session.prompt', 'prompt', {
      text,
      newSession: path === null && !isCommand,
      activeSkills: Array.isArray(activeSkills) ? [...activeSkills] : undefined,
    });
    if (!res.ok) {
      // 错误回写最后一条 assistant 消息（session_created 可能已迁移 key）
      const targetPath = get().currentKey();
      writeErrorToLast(targetPath, res.error);
      streamingKeys.delete(targetPath);
      set({ streamingSessions: new Set(streamingKeys) });
      promptFsmFor(targetPath).send('ERROR');
    }
    // 成功路径终态由 agent_settled 事件收敛（避免与事件竞态）
  },

  abort: async (_path) => {
    await run('session.abort', 'abort');
    promptFsmFor(get().currentKey()).send('ABORT');
  },

  /** 关闭标签（≠ 删除）：只动 openPaths。 */
  close: async (path) => {
    useUiStore.getState().closeSessionTab(path);
    const nextActive = useUiStore.getState().activePath;
    if (nextActive) await get().loadSession(nextActive);
    promptFsms.delete(path);
  },

  /** 真删除：后端 JSONL 删除 + 全部相关态清理 + 活跃重选。 */
  remove: async (path) => {
    await run('session.delete', 'delete_session', { path });
    set((s) => {
      const messages = { ...s.messagesBySession };
      const tokens = { ...s.tokensBySession };
      delete messages[path];
      delete tokens[path];
      return { messagesBySession: messages, tokensBySession: tokens };
    });
    streamingKeys.delete(path);
    set({ streamingSessions: new Set(streamingKeys) });
    loaded.delete(path);
    promptFsms.delete(path);

    await get().refreshSessions();
    const list = get().sessions;
    const nextActive = list.length > 0 ? list[0].path : null;
    const activePath = useUiStore.getState().activePath;
    useUiStore
      .getState()
      .removeSessionFromTabs(
        path,
        activePath === path ? nextActive : activePath,
      );
    if (activePath === path && nextActive) await get().select(nextActive);
  },

  rename: async (path, name) => {
    await run('session.rename', 'rename_session', { path, name });
    await get().refreshSessions();
  },

  setThinkingLevelOptimistic: (level) => set({ piThinkingLevel: level }),

  // ─── 事件路由（pi:event 帧） ─────────────────────────────

  handlePiFrame: (frame) => {
    const ev = frame.event;
    lastSeq = Math.max(lastSeq, frame.seq);

    // ── workbench 内部事件族 ──
    if (ev.type === 'agent_status_changed') {
      useAgentConfigStore.getState().applyStatus(ev.status);
      return;
    }
    if (ev.type === 'session_created') {
      const targetPath = ev.sessionPath;
      set((s) => {
        const messages = { ...s.messagesBySession };
        const tokens = { ...s.tokensBySession };
        const pending = messages['__new__'];
        if (pending) {
          messages[targetPath] = pending;
          delete messages['__new__'];
        }
        const pendingTokens = tokens['__new__'];
        if (pendingTokens) {
          tokens[targetPath] = pendingTokens;
          delete tokens['__new__'];
        }
        return {
          piSessionFile: targetPath,
          messagesBySession: messages,
          tokensBySession: tokens,
        };
      });
      // PromptFSM key 迁移（流式继续在真实 path 上）
      const newFsm = promptFsms.get('__new__');
      if (newFsm) {
        promptFsms.delete('__new__');
        promptFsms.set(targetPath, newFsm);
        newFsm.send('SESSION_CREATED'); // sending → streaming
      }
      streamingKeys.delete('__new__');
      streamingKeys.add(targetPath);
      set({ streamingSessions: new Set(streamingKeys) });
      loaded.add(targetPath);
      loaded.delete('__new__');
      // 注意：不在此调 openSessionTab（会发 session.openTab → runtime.switchSession，
      // 把刚刚发出、正在流式的 prompt 换代中断）。主进程 onSessionCreated 已写入
      // openPaths / activePath 并广播 ui-state，渲染层只消费广播。
      void get().refreshSessions();
      return;
    }

    if (ev.type === 'session_rebound') {
      set({ piSessionFile: ev.sessionFile || null });
      const sync = mainBridge
        ? mainBridge.sync().then((s) => s.agent.thinkingLevel)
        : piAPI.sync().then((s) => s.state.thinkingLevel);
      void sync
        .then((level) => set({ piThinkingLevel: level }))
        .catch(() => {
          /* ignore */
        });
      return;
    }

    // ── 官方事件族（路由键 = 当前 runtime 会话） ──
    const targetPath = get().piSessionFile ?? '__new__';
    const fsm = promptFsms.get(targetPath);

    if (ev.type === 'error') {
      writeErrorToLast(targetPath, ev.message);
      streamingKeys.delete(targetPath);
      streamingKeys.delete('__new__');
      const uiKey = get().currentKey();
      streamingKeys.delete(uiKey);
      set({ streamingSessions: new Set(streamingKeys) });
      fsm?.send('ERROR');
      return;
    }

    if (ev.type === 'thinking_level_changed') {
      set({ piThinkingLevel: ev.level });
      return;
    }

    switch (ev.type) {
      case 'message_start': {
        if (ev.message.role === 'user') {
          // 用户消息回显去重（确定性）
          const rawContent: unknown = ev.message.content;
          const text =
            typeof rawContent === 'string'
              ? rawContent
              : Array.isArray(rawContent)
                ? ((
                    rawContent.find(
                      (c) => (c as { type?: string }).type === 'text',
                    ) as { text?: string } | undefined
                  )?.text ?? '')
                : '';
          const echoIdx = text ? pendingUserEcho.indexOf(text) : -1;
          if (echoIdx >= 0) {
            pendingUserEcho.splice(echoIdx, 1);
          } else if (text && !wasUserAppendedRecently(targetPath, text)) {
            noteUserAppend(targetPath, text);
            appendMessage(targetPath, {
              id: uid(),
              role: 'user',
              blocks: [{ type: 'text', text }],
            });
          }
        } else if (ev.message.role === 'assistant') {
          ensureStreamingAssistant(targetPath);
        }
        break;
      }
      case 'message_update': {
        const d = ev.assistantMessageEvent;
        if (d.type === 'text_delta' && typeof d.delta === 'string')
          appendDelta(targetPath, 'text', d.delta);
        else if (d.type === 'thinking_delta' && typeof d.delta === 'string')
          appendDelta(targetPath, 'thinking', d.delta);
        fsm?.send('DELTA');
        break;
      }
      case 'message_end': {
        if (ev.message.role === 'assistant')
          reconcileAssistant(targetPath, ev.message);
        else if (ev.message.role === 'user') {
          // 新会话行补刷：列表缺此会话则刷新
          if (!get().sessions.some((s) => s.path === targetPath))
            void get().refreshSessions();
        }
        break;
      }
      case 'tool_execution_start': {
        pushToolBlock(targetPath, {
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
          status: 'running',
        });
        fsm?.send('DELTA');
        break;
      }
      case 'tool_execution_end': {
        updateToolBlock(
          targetPath,
          ev.toolCallId,
          ev.isError ? 'error' : 'done',
          stringifyToolResult(ev.result),
        );
        break;
      }
      case 'queue_update': {
        set({
          piQueue: { steering: [...ev.steering], followUp: [...ev.followUp] },
        });
        break;
      }
      case 'agent_settled': {
        set({ piQueue: { steering: [], followUp: [] } });
        // 会话级完成（含 abort 兜底）
        settleRunningTools(targetPath);
        dropEmptyPlaceholders();
        streamingKeys.delete(targetPath);
        streamingKeys.delete('__new__');
        const uiKey = get().currentKey();
        streamingKeys.delete(uiKey);
        set({ streamingSessions: new Set(streamingKeys) });
        fsm?.send('DONE');
        flashSettled(targetPath);
        void get().refreshSessions();
        if (!mainBridge) {
          void piAPI.cmd
            .invoke<{ tokens: Tokens }>('get_session_stats')
            .then((res) => {
              if (res.ok)
                set((s) => ({
                  tokensBySession: {
                    ...s.tokensBySession,
                    [targetPath]: res.data.tokens,
                  },
                }));
            })
            .catch(() => {
              /* ignore */
            });
        }
        break;
      }
      default:
        break;
    }
  },

  /** 启动初始化：握手 + 会话列表 + 恢复上次现场。 */
  init: async () => {
    if (mainBridge) {
      const sync = await mainBridge.sync();
      lastSeq = sync.seq;
      set({
        piThinkingLevel: sync.agent.thinkingLevel,
        piSessionFile: sync.agent.sessionFile,
      });
      if (sync.agent.isStreaming) {
        streamingKeys.add(sync.agent.sessionFile ?? '__new__');
        set({ streamingSessions: new Set(streamingKeys) });
      }
    } else {
      const sync = await piAPI.sync();
      lastSeq = sync.seq;
      set({ piThinkingLevel: sync.state.thinkingLevel });
      if (sync.state.isStreaming) {
        streamingKeys.add(get().piSessionFile ?? '__new__');
        set({ streamingSessions: new Set(streamingKeys) });
      }
    }
    await get().refreshSessions();
    const list = get().sessions;

    const ui = useUiStore.getState();
    const savedActive = ui.activePath;
    const savedOpen = ui.openPaths;

    if (savedOpen.length > 0) {
      const valid = savedOpen.filter((p) => list.some((s) => s.path === p));
      const target =
        savedActive && valid.includes(savedActive)
          ? savedActive
          : (valid[0] ?? null);
      setUiState({
        openPaths: valid.length > 0 ? valid : [],
        activePath: target,
      });
      for (const p of valid) await get().loadSession(p);
    } else if (list.length > 0) {
      await get().select(list[0].path);
    }
  },
}));

// 全局事件监听（main.tsx init 时挂一次）
export function bindPiEvents(): void {
  if (mainBridge) {
    mainBridge.onEvent((frame) =>
      useConversationStore.getState().handlePiFrame(frame),
    );
    return;
  }
  piAPI.onEvent((frame) =>
    useConversationStore.getState().handlePiFrame(frame),
  );
}
