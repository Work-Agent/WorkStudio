/**
 * Mock pi 运行时 —— 模拟 pi:cmd:invoke / pi:event / pi:sync 的行为，让页面可独立运行。
 * 覆盖会话 CRUD / 流式回复 / 工具卡 / 队列 / 思考档位 / 统计；真实主进程服务就绪后移除。
 */
import type {
  ParsedMessage,
  PiBridgeAPI,
  PiCommandResponse,
  PiEventFrame,
  PiSessionEvent,
  PiSyncResult,
  SessionMeta,
  ThinkingLevel,
} from '../../../shared/types';
import {
  demoMessages,
  demoSessionDomains,
  demoSessions,
  demoTokens,
  demoWorkspace,
} from './data';

export interface Tokens {
  input: number;
  output: number;
}

export function createMockPiAPI(): PiBridgeAPI {
  let seq = 0;
  let sessions: SessionMeta[] = demoSessions.map((s) => ({ ...s }));
  const messages = new Map<string, ParsedMessage[]>(
    Object.entries(demoMessages).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v)) as ParsedMessage[],
    ]),
  );
  const tokens = new Map<string, Tokens>(
    Object.entries(demoTokens).map(([k, v]) => [k, { ...v }]),
  );
  const sessionDomains = { ...demoSessionDomains };
  let currentPath: string | null = null;
  let isStreaming = false;
  let thinkingLevel: ThinkingLevel = 'medium';
  let queue: { steering: string[]; followUp: string[] } = {
    steering: [],
    followUp: [],
  };
  let runId = 0;

  const listeners = new Set<(frame: PiEventFrame) => void>();
  const emit = (event: PiSessionEvent): void => {
    const frame: PiEventFrame = { seq: ++seq, event };
    for (const listener of listeners) listener(frame);
  };

  const ok = <T>(data: T): PiCommandResponse<T> => ({ ok: true, data });
  const fail = (error: string): PiCommandResponse<never> => ({
    ok: false,
    error,
  });

  const previewOf = (path: string): string => {
    const list = messages.get(path) ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const msg = list[i];
      if (msg.role !== 'assistant') continue;
      const text = msg.blocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      if (text) return text.slice(0, 60);
    }
    return '';
  };

  const createSession = (name: string): SessionMeta => {
    const path = `pi/sessions/${Date.now()}.jsonl`;
    const session: SessionMeta = {
      path,
      name: name.slice(0, 18) || '新任务',
      createdAt: Date.now(),
      preview: '',
    };
    sessions = [session, ...sessions];
    messages.set(path, []);
    tokens.set(path, { input: 0, output: 0 });
    currentPath = path;
    emit({
      type: 'session_created',
      sessionName: session.name,
      sessionPath: path,
    });
    return session;
  };

  /** 流式回复模拟：assistant 消息逐段产出（thinking → text → tool → 终态）。 */
  const runPrompt = (path: string, text: string): void => {
    const mine = ++runId;
    isStreaming = true;
    const assistant: ParsedMessage = { role: 'assistant', blocks: [] };
    const list = messages.get(path)!;
    list.push(assistant);

    const thinkText =
      '理解任务目标，先检索相关业务数据与本地文档，再规划执行步骤…';
    const replyText = `已收到指令：「${text}」。我已完成初步分析，并调用了工作区工具收集资料，结果已整理如下。`;
    const toolCallId = `tc-${Date.now() % 100000}`;

    const later = (ms: number, fn: () => void): void => {
      window.setTimeout(() => {
        if (runId === mine) fn();
      }, ms);
    };

    // 用户消息回显（send() 已乐观渲染，此处由去重队列消费）
    emit({
      type: 'message_start',
      message: { role: 'user', content: [{ type: 'text', text }] },
    });
    emit({
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    });

    later(120, () =>
      emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: thinkText },
      }),
    );
    later(320, () =>
      emit({
        type: 'tool_execution_start',
        toolCallId,
        toolName: 'query_business',
        args: { object: 'order', filter: { status: 'submitted' } },
      }),
    );
    later(760, () =>
      emit({
        type: 'tool_execution_end',
        toolCallId,
        isError: false,
        result: {
          content: [
            { type: 'text', text: '命中 12 条记录；其中 3 条属于重点客户。' },
          ],
        },
      }),
    );

    const chunks = replyText.match(/.{1,8}/g) ?? [];
    chunks.forEach((chunk, i) => {
      later(900 + i * 60, () =>
        emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: chunk },
        }),
      );
    });

    const doneAt = 900 + chunks.length * 60 + 240;
    later(doneAt, () => {
      assistant.blocks = [
        { type: 'thinking', text: thinkText },
        {
          type: 'tool',
          toolCallId,
          toolName: 'query_business',
          args: { object: 'order', filter: { status: 'submitted' } },
          result: '命中 12 条记录；其中 3 条属于重点客户。',
        },
        { type: 'text', text: replyText },
      ];
      emit({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: thinkText },
            {
              type: 'toolCall',
              id: toolCallId,
              name: 'query_business',
              arguments: { object: 'order' },
            },
            { type: 'text', text: replyText },
          ],
        },
      });
      const current = tokens.get(path) ?? { input: 0, output: 0 };
      tokens.set(path, {
        input: current.input + 320 + Math.floor(text.length * 6),
        output: current.output + Math.floor(replyText.length * 1.5),
      });
      isStreaming = false;
      queue = { steering: [], followUp: [] };
      emit({ type: 'queue_update', ...queue });
      sessions = sessions.map((s) =>
        s.path === path
          ? {
              ...s,
              name: s.name === '新任务' ? text.slice(0, 18) : s.name,
              preview: previewOf(path),
            }
          : s,
      );
      emit({ type: 'agent_settled' });
    });
  };

  const stats = (path: string | null) => {
    const list = path ? (messages.get(path) ?? []) : [];
    const t = path
      ? (tokens.get(path) ?? { input: 0, output: 0 })
      : { input: 0, output: 0 };
    let userMessages = 0;
    let assistantMessages = 0;
    let toolCalls = 0;
    let toolResults = 0;
    for (const m of list) {
      if (m.role === 'user') userMessages += 1;
      else assistantMessages += 1;
      for (const b of m.blocks) {
        if (b.type === 'tool') {
          toolCalls += 1;
          if (b.result) toolResults += 1;
        }
      }
    }
    return {
      sessionFile: path ?? undefined,
      sessionId:
        (path ?? 'in-memory').split('/').pop()?.replace('.jsonl', '') ??
        'in-memory',
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: userMessages + assistantMessages,
      tokens: {
        input: t.input,
        output: t.output,
        cacheRead: Math.floor(t.input * 0.42),
        cacheWrite: Math.floor(t.input * 0.08),
        total: t.input + t.output,
      },
      cost: (t.input / 1_000_000) * 3 + (t.output / 1_000_000) * 15,
      contextUsage: {
        tokens: t.input,
        contextWindow: 200_000,
        percent: t.input / 200_000,
      },
    };
  };

  const handle = async (
    command: string,
    params?: unknown,
  ): Promise<PiCommandResponse<unknown>> => {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (command) {
      case 'list_sessions':
        return ok(sessions);
      case 'session_domains':
        return ok(sessionDomains);
      case 'switch_session': {
        const path = String(p['path'] ?? '');
        if (!messages.has(path)) return fail(`session not found: ${path}`);
        currentPath = path;
        return ok({
          messages: messages.get(path) ?? [],
          tokens: tokens.get(path) ?? { input: 0, output: 0 },
        });
      }
      case 'prompt': {
        const text = String(p['text'] ?? '');
        const newSession = p['newSession'] === true;
        let path = currentPath;
        if (newSession || !path) {
          path = createSession(text).path;
        }
        (messages.get(path) ?? []).push({
          role: 'user',
          blocks: [{ type: 'text', text }],
        });
        runPrompt(path, text);
        return ok({});
      }
      case 'abort': {
        runId += 1; // 中止进行中的模拟流
        isStreaming = false;
        queue = { steering: [], followUp: [] };
        emit({ type: 'queue_update', ...queue });
        emit({ type: 'agent_settled' });
        return ok({});
      }
      case 'new_session': {
        const session = createSession('新任务');
        return ok({ sessionPath: session.path });
      }
      case 'delete_session': {
        const path = String(p['path'] ?? '');
        sessions = sessions.filter((s) => s.path !== path);
        messages.delete(path);
        tokens.delete(path);
        if (currentPath === path) currentPath = null;
        return ok({});
      }
      case 'rename_session': {
        const path = String(p['path'] ?? '');
        const name = String(p['name'] ?? '');
        sessions = sessions.map((s) => (s.path === path ? { ...s, name } : s));
        return ok({});
      }
      case 'steer':
      case 'follow_up': {
        const text = String(p['text'] ?? '');
        queue =
          command === 'steer'
            ? {
                steering: [...queue.steering, text],
                followUp: [...queue.followUp],
              }
            : {
                steering: [...queue.steering],
                followUp: [...queue.followUp, text],
              };
        emit({ type: 'queue_update', ...queue });
        return ok({});
      }
      case 'clear_queue': {
        queue = { steering: [], followUp: [] };
        emit({ type: 'queue_update', ...queue });
        return ok({});
      }
      case 'set_thinking_level': {
        thinkingLevel = String(p['level'] ?? 'medium') as ThinkingLevel;
        emit({ type: 'thinking_level_changed', level: thinkingLevel });
        return ok({});
      }
      case 'get_session_stats':
        return ok(stats(currentPath));
      case 'get_commands':
        return ok({ commands: [] });
      case 'compact':
        return ok({});
      default:
        return ok({});
    }
  };

  return {
    cmd: {
      invoke: (command, params) =>
        handle(command, params) as Promise<PiCommandResponse<never>>,
    },
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    sync: (): Promise<PiSyncResult> =>
      Promise.resolve({
        state: {
          model: {
            provider: 'anthropic',
            id: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
          },
          thinkingLevel,
          isStreaming,
          isCompacting: false,
          steeringMode: 'all',
          followUpMode: 'all',
          sessionFile: currentPath,
          sessionId: currentPath?.split('/').pop() ?? null,
          sessionName:
            sessions.find((s) => s.path === currentPath)?.name ?? null,
          autoCompactionEnabled: true,
          messageCount: currentPath
            ? (messages.get(currentPath)?.length ?? 0)
            : 0,
          pendingMessageCount: queue.steering.length + queue.followUp.length,
          cwd: demoWorkspace,
        },
        seq,
      }),
    onUIRequest: () => () => undefined,
    uiRespond: () => Promise.resolve(true),
    pushEditorState: () => undefined,
  };
}

/** 供 mock agentAPI 复用：发送运行配置变更事件（思考档位切换等）。 */
export type MockPiRuntime = ReturnType<typeof createMockPiAPI>;
