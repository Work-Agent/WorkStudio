/**
 * 助手视图的 next 投影：workspace / agent / sessions / shell / messages。
 *
 * 只依赖 window.workStudio 与 domain/resources；不再使用旧路径兼容层。
 */
import { useEffect, useMemo, useState } from 'react';
import { effectiveTheme } from '../../shared/domains/appearance.ts';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type {
  AgentSnapshot,
  ModelOption,
  ParsedBlock,
  ParsedMessage,
  SessionMeta,
} from '../../../shared/types.ts';
import type { DomainUpdate } from '@workstudio/sdk';
import type { SessionTask } from '../../../shared/session-task.ts';

interface SessionListItem {
  id: string;
  path: string;
  name: string;
  preview?: string;
  createdAt: number;
  messageCount?: number;
}

interface SessionToolState {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  done: boolean;
}

interface SessionStreamState {
  streaming: boolean;
  text: string;
  thinking: string;
  tools: SessionToolState[];
}

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
    const apply = (current: T, data: unknown): T => {
      if (data === null || data === undefined) return current;
      if (Array.isArray(data)) return data as T;
      if (
        typeof data === 'object' &&
        typeof current === 'object' &&
        current !== null
      ) {
        return { ...current, ...(data as Record<string, unknown>) } as T;
      }
      return data as T;
    };
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot' || update.type === 'patch') {
        setValue((current) => apply(current, update.data));
      }
    });
    void bridge.subscribe(domain, resource).then((data) => {
      if (alive) setValue((current) => apply(current, data));
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

interface SessionsAggregate {
  current?: AgentSnapshot | null;
  task?: SessionTask | null;
  items?: SessionMeta[];
  opened?: string[];
  commands?: Array<{ name: string; description?: string; source?: string }>;
  thinking?: { level?: string | null; levels?: string[] };
  active?: SessionsActive;
}

function useSessions(): SessionsAggregate {
  return useResource<SessionsAggregate>('agent', 'sessions', {});
}

function useWorkspace(): WorkspaceMeta | null {
  const registry = useResource<{ current?: WorkspaceMeta | null }>(
    'workspace',
    'registry',
    {},
  );
  return registry.current ?? null;
}

export function useAppAgent(): AgentSnapshot | null {
  return useSessions().current ?? null;
}

export function useAppTask(): SessionTask | null {
  return useSessions().task ?? null;
}

export function useAppModels(): ModelOption[] | null {
  const models = useResource<ModelOption[]>('agent', 'models', []);
  return useAppAvailable() ? models : null;
}

export function useAppSessions(): SessionMeta[] | null {
  const sessions = useSessions().items ?? [];
  return useAppAvailable() ? sessions : null;
}

export function useAppShell(): AssistantShell | null {
  const workspace = useWorkspace();
  const agent = useAppAgent();
  const sessions = useSessions();
  const opened = sessions.opened ?? [];
  const themeState = useResource<{ theme: 'light' | 'dark' }>(
    'shell',
    'appearance',
    { theme: effectiveTheme() },
  );
  const layouts = useResource<
    Array<{ windowId: string; scene?: { aiFloating?: boolean } }>
  >('shell', 'layout', []);
  const scene =
    layouts.find((record) => record.windowId === workspace?.id)?.scene ?? null;

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
  const sessions = useSessions();
  const active = sessions.active ?? {
    sessionId: null,
    messages: [],
    stream: idleStream(),
  };
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
