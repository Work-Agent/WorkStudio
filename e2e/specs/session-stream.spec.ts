import { expect, test } from '@playwright/test';
import type { AgentHost } from '../../src/main/agent/agent-host';
import {
  isSessionStreamEvent,
  SessionsService,
  type SessionStreamEvent,
  type SessionStreamState,
} from '../../src/main/service/sessions';
import type { PiEventFrame, PiSessionEvent } from '../../src/shared/types';

const sessionFile = '/tmp/e2e-session.jsonl';

function fakeAgent(): AgentHost {
  return {
    getSnapshot: () => ({
      configured: true,
      provider: 'test',
      modelId: 'test',
      modelName: 'test',
      thinkingLevel: null,
      isStreaming: true,
      isCompacting: false,
      steeringMode: 'all',
      followUpMode: 'all',
      autoCompaction: false,
      sessionFile,
      sessionId: 's1',
      sessionName: 'e2e',
      messageCount: 0,
      pendingMessageCount: 0,
      cwd: '/tmp',
      workspacePath: '/tmp',
    }),
    getMessages: async () => [],
    listSessions: async () => [],
  } as unknown as AgentHost;
}

test('流式事件归约为完整状态并发出受约束增量', () => {
  const service = new SessionsService(fakeAgent());
  const states: SessionStreamState[] = [];
  const events: SessionStreamEvent[] = [];
  service.onStream((_id, state) => states.push(state));
  service.onStreamEvent((_id, event) => events.push(event));

  let seq = 0;
  const push = (event: PiSessionEvent): void => {
    service.receiveFrame({ seq: (seq += 1), event } satisfies PiEventFrame);
  };

  push({ type: 'message_start', message: { role: 'assistant' } });
  push({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'hel' },
  });
  push({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'lo' },
  });
  push({
    type: 'tool_execution_start',
    toolCallId: 't1',
    toolName: 'read',
    args: { path: 'a' },
  });
  push({
    type: 'tool_execution_end',
    toolCallId: 't1',
    isError: false,
    result: 'ok',
  });
  push({ type: 'message_end', message: { role: 'assistant' } });
  push({ type: 'agent_settled' });

  expect(states.at(-1)).toEqual({
    streaming: false,
    text: 'hello',
    thinking: '',
    tools: [
      {
        id: 't1',
        name: 'read',
        args: { path: 'a' },
        result: 'ok',
        isError: false,
        done: true,
      },
    ],
  });
  expect(events.map((event) => event.type)).toEqual([
    'message-start',
    'append',
    'append',
    'tool-start',
    'tool-end',
    'message-end',
    'settled',
  ]);
});

test('流式事件校验器拒绝未知载荷', () => {
  expect(
    isSessionStreamEvent({ type: 'append', channel: 'text', delta: 'a' }),
  ).toBe(true);
  expect(
    isSessionStreamEvent({ type: 'append', channel: 'unknown', delta: 'a' }),
  ).toBe(false);
  expect(isSessionStreamEvent({ type: 'unknown' })).toBe(false);
});
