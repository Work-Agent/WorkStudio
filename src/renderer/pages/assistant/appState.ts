/**
 * 助手视图的 next 投影：workspace / agent / sessions / shell / messages。
 *
 * 只依赖 window.workStudio 与 domain/resources；不再使用旧路径兼容层。
 */
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type {
  AgentSnapshot,
  ModelOption,
  ParsedBlock,
  ParsedMessage,
  SessionMeta,
} from '../../../shared/types.ts';
import type {
  SessionListItem,
  SessionStreamState,
} from '../../../main/modules/sessions/service.ts';
import type { DomainUpdate } from '../../../main/runtime/shared.ts';
import type { SessionTask } from '../../../shared/session-task.ts';

export interface AssistantShell {
  ui: {
    theme: 'light' | 'dark';
    aiFloating: boolean;
    inputExpanded: boolean;
    activePath: string | null;
    openPaths: string[];
    selectedSkills: string[];
  };
}

interface SessionsActive {
  sessionId: string | null;
  messages: ParsedMessage[];
  stream: SessionStreamState;
}

const idleStream = (): SessionStreamState => ({
  streaming: false,
  text: '',
  thinking: '',
  tools: [],
});

function useResource<T>(
  domain: string,
  resource: string | null,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const bridge =
      typeof window !== 'undefined' ? window.workStudio : undefined;
    if (!bridge || !resource) return;
    let alive = true;
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot') setValue(update.data as T);
      else if (update.type === 'patch') {
        setValue((current) => ({ ...current, ...update.data }) as T);
      }
    });
    void bridge.subscribe(domain, resource).then((data) => {
      if (alive) setValue(data as T);
    });
    return () => {
      alive = false;
      off();
      bridge.unsubscribe(domain, resource);
    };
  }, [domain, resource]);
  return value;
}

export function useAppAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.workStudio);
}

function useWorkspace(): WorkspaceMeta | null {
  return useResource<WorkspaceMeta | null>('workspaces', 'current', null);
}

export function useAppAgent(): AgentSnapshot | null {
  return useResource<AgentSnapshot | null>('sessions', 'current', null);
}

export function useAppTask(): SessionTask | null {
  return useResource<SessionTask | null>('sessions', 'task', null);
}

export function useAppModels(): ModelOption[] | null {
  const models = useResource<ModelOption[]>('sessions', 'models', []);
  return useAppAvailable() ? models : null;
}

export function useAppSessions(): SessionMeta[] | null {
  const sessions = useResource<SessionListItem[]>('sessions', 'list', []);
  return useAppAvailable() ? sessions : null;
}

export function useAppShell(): AssistantShell | null {
  const workspace = useWorkspace();
  const agent = useAppAgent();
  const opened = useResource<string[]>('sessions', 'opened', []);
  const themeState = useResource<{ theme: 'light' | 'dark' }>(
    'theme',
    'current',
    { theme: 'dark' },
  );
  const scene = useResource<{ aiFloating?: boolean } | null>(
    'scene',
    workspace?.id ?? null,
    null,
  );

  if (!useAppAvailable()) return null;
  const activePath = agent?.sessionFile ?? null;
  const openPaths = [
    ...new Set([...opened, ...(activePath ? [activePath] : [])]),
  ];
  return {
    ui: {
      theme: themeState.theme,
      aiFloating: scene?.aiFloating ?? false,
      inputExpanded: false,
      activePath,
      openPaths,
      selectedSkills: [],
    },
  };
}

function toolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fromStream(stream: SessionStreamState | null): ParsedMessage | null {
  if (!stream) return null;
  const blocks: ParsedBlock[] = [];
  if (stream.thinking) blocks.push({ type: 'thinking', text: stream.thinking });
  if (stream.text) blocks.push({ type: 'text', text: stream.text });
  for (const tool of stream.tools) {
    blocks.push({
      type: 'tool',
      toolCallId: tool.id,
      toolName: tool.name,
      args: tool.args,
      result: tool.done ? toolResult(tool.result) : '',
    });
  }
  return blocks.length ? { role: 'assistant', blocks } : null;
}

function textOf(message: ParsedMessage): string {
  return message.blocks
    .map((block) =>
      block.type === 'text' || block.type === 'thinking' ? block.text : '',
    )
    .join('');
}

function userTextOf(message: ParsedMessage | undefined): string {
  if (!message || message.role !== 'user') return '';
  return message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

interface PendingUser {
  text: string;
  queued: boolean;
  base: number;
  sessionId: string | null;
}

export function useAppMessages(activePath: string | null): {
  messages: ParsedMessage[];
  streaming: boolean;
  optimistic: string | undefined;
  pushOptimistic: (text: string, queued?: boolean) => void;
  clearNewTask: () => void;
} | null {
  const available = useAppAvailable();
  const active = useResource<SessionsActive>('sessions', 'active', {
    sessionId: null,
    messages: [],
    stream: idleStream(),
  });
  const [pending, setPending] = useState<PendingUser | undefined>(undefined);
  const sessionId = activePath ? encodeURIComponent(activePath) : null;
  const matches = active.sessionId === sessionId;
  const history = matches ? active.messages : [];
  const stream = matches ? active.stream : null;

  const matchesSession = (value: PendingUser): boolean =>
    value.sessionId === null || value.sessionId === sessionId;
  const echoedOf = (value: PendingUser): boolean =>
    history
      .slice(value.sessionId === null ? 0 : value.base)
      .some((message) => userTextOf(message) === value.text);

  const messages = useMemo(() => {
    const current = pending && matchesSession(pending) ? pending : null;
    const optimistic: ParsedMessage | null =
      current && !echoedOf(current)
        ? { role: 'user', blocks: [{ type: 'text', text: current.text }] }
        : null;
    const live = fromStream(stream);
    if (!live) return optimistic ? [...history, optimistic] : history;
    if (optimistic && current?.queued) {
      return [...history, live, optimistic];
    }
    if (!optimistic) {
      const last = history.at(-1);
      if (last?.role === 'assistant' && textOf(last) === textOf(live)) {
        return history;
      }
      return [...history, live];
    }
    return [...history, optimistic, live];
  }, [history, stream, pending, sessionId]);

  useEffect(() => {
    if (!pending) return;
    if (!matchesSession(pending) || echoedOf(pending)) setPending(undefined);
  }, [history, pending, sessionId]);

  if (!available) return null;
  return {
    messages,
    streaming: stream?.streaming ?? false,
    optimistic: pending?.text,
    pushOptimistic: (text: string, queued = false) =>
      setPending({ text, queued, base: history.length, sessionId }),
    clearNewTask: () => setPending(undefined),
  };
}
