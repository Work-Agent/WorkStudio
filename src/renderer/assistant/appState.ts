import type { SessionTask } from '../../shared/session-task';
/**
 * 助手视图的 app 投影：workspace / agent / sessions / shell / messages。
 *
 * 只依赖 window.appBridge；旧入口下 available=false，hook 返回 null，由旧路径兜底。
 */
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceMeta } from '../../shared/app';
import type {
  AgentSnapshot,
  ModelOption,
  ParsedBlock,
  ParsedMessage,
  SessionMeta,
} from '../../shared/types';
import type {
  SessionListItem,
  SessionStreamState,
} from '../../main/service/sessions';

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

let availability: Promise<boolean> | null = null;

function checkAppAvailable(): Promise<boolean> {
  if (!availability) {
    availability = window.appBridge
      ? window.appBridge.available().catch(() => false)
      : Promise.resolve(false);
  }
  return availability;
}

export function useAppAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void checkAppAvailable().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

function useWorkspace(available: boolean): WorkspaceMeta | null {
  const [workspace, setWorkspace] = useState<WorkspaceMeta | null>(null);
  useEffect(() => {
    if (!available || !window.appBridge) return;
    const off = window.appBridge.on((frame) => {
      if (frame.type === 'state' && frame.path === '/workspaces/current') {
        setWorkspace(frame.value as WorkspaceMeta | null);
      }
    });
    void window.appBridge.watch(['/workspaces/current']);
    return off;
  }, [available]);
  return workspace;
}

export function useAppAgent(): AgentSnapshot | null {
  const available = useAppAvailable();
  const workspace = useWorkspace(available);
  const [agent, setAgent] = useState<AgentSnapshot | null>(null);

  useEffect(() => {
    if (!available || !window.appBridge || !workspace) return;
    const path = `/workspaces/${workspace.id}/sessions/current`;
    const off = window.appBridge.on((frame) => {
      if (frame.type === 'state' && frame.path === path) {
        setAgent(frame.value as AgentSnapshot | null);
      }
    });
    void window.appBridge.watch([path]);
    return off;
  }, [available, workspace?.id]);

  return available ? agent : null;
}

/**
 * 可选模型列表（状态路径订阅）。
 *
 * 必须走订阅而不是一次性读取：模型在设置页增删时当前模型并不变化，
 * 用「当前模型变化时重取」的写法会让切换器一直停在旧列表上。
 */
export function useAppModels(): ModelOption[] | null {
  const available = useAppAvailable();
  const workspace = useWorkspace(available);
  const [models, setModels] = useState<ModelOption[] | null>(null);

  useEffect(() => {
    if (!available || !window.appBridge || !workspace) return;
    const path = `/workspaces/${workspace.id}/sessions/models`;
    const off = window.appBridge.on((frame) => {
      if (frame.type === 'state' && frame.path === path) {
        setModels((frame.value as ModelOption[] | null) ?? []);
      }
    });
    void window.appBridge.watch([path]);
    return off;
  }, [available, workspace?.id]);

  return available ? models : null;
}

export function useAppSessions(): SessionMeta[] | null {
  const available = useAppAvailable();
  const workspace = useWorkspace(available);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  useEffect(() => {
    if (!available || !window.appBridge || !workspace) return;
    const path = `/workspaces/${workspace.id}/sessions`;
    const off = window.appBridge.on((frame) => {
      if (frame.type === 'state' && frame.path === path) {
        setSessions(frame.value as SessionListItem[]);
      }
    });
    void window.appBridge.watch([path]);
    return off;
  }, [available, workspace?.id]);

  return available ? sessions : null;
}

export function useAppShell(): AssistantShell | null {
  const available = useAppAvailable();
  const workspace = useWorkspace(available);
  const agent = useAppAgent();
  const [opened, setOpened] = useState<string[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [scene, setScene] = useState<{ aiFloating?: boolean } | null>(null);

  useEffect(() => {
    if (!available || !window.appBridge) return;
    const off = window.appBridge.on((frame) => {
      if (frame.type !== 'state') return;
      if (
        workspace &&
        frame.path === `/workspaces/${workspace.id}/sessions/opened`
      )
        setOpened((frame.value as string[]) ?? []);
      if (frame.path === '/theme') setTheme(frame.value as 'light' | 'dark');
      if (workspace && frame.path === `/scene/${workspace.id}`) {
        setScene(frame.value as { aiFloating?: boolean });
      }
    });
    void window.appBridge.watch(['/theme']);
    if (workspace)
      void window.appBridge.watch([
        `/scene/${workspace.id}`,
        `/workspaces/${workspace.id}/sessions/opened`,
      ]);
    return off;
  }, [available, workspace?.id]);

  if (!available) return null;
  const activePath = agent?.sessionFile ?? null;
  const openPaths = [
    ...new Set([...opened, ...(activePath ? [activePath] : [])]),
  ];
  return {
    ui: {
      theme,
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
  /** 发送时正在流式（steer / followUp），应排在当前回复之后。 */
  queued: boolean;
  /** 推送时的历史长度，用于确认回显。 */
  base: number;
  /** 推送时所属会话（null = 新任务态，历史从零开始）。 */
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
  const workspace = useWorkspace(available);
  const [historyView, setHistory] = useState<{
    key: string;
    value: ParsedMessage[];
  } | null>(null);
  const [streamView, setStream] = useState<{
    key: string;
    value: SessionStreamState;
  } | null>(null);
  const [pending, setPending] = useState<PendingUser | undefined>(undefined);
  const sessionId = activePath ? encodeURIComponent(activePath) : null;
  const viewKey = `${workspace?.id}/${sessionId}`;
  const history = historyView?.key === viewKey ? historyView.value : [];
  const stream = streamView?.key === viewKey ? streamView.value : null;

  useEffect(() => {
    if (!available || !window.appBridge || !workspace || !sessionId) return;
    const base = `/workspaces/${workspace.id}/sessions/${sessionId}`;
    const off = window.appBridge.on((frame) => {
      if (frame.type !== 'state') return;
      if (frame.path === `${base}/messages`) {
        setHistory({ key: viewKey, value: frame.value as ParsedMessage[] });
      } else if (frame.path === `${base}/stream`) {
        setStream({ key: viewKey, value: frame.value as SessionStreamState });
      }
    });
    void window.appBridge.watch([`${base}/messages`, `${base}/stream`]);
    return off;
  }, [available, workspace?.id, sessionId]);

  const matchesSession = (value: PendingUser): boolean =>
    value.sessionId === null || value.sessionId === sessionId;
  const echoedOf = (value: PendingUser): boolean =>
    history
      .slice(value.sessionId === null ? 0 : value.base)
      .some((message) => userTextOf(message) === value.text);

  const messages = useMemo(() => {
    const active = pending && matchesSession(pending) ? pending : null;
    const optimistic: ParsedMessage | null =
      active && !echoedOf(active)
        ? { role: 'user', blocks: [{ type: 'text', text: active.text }] }
        : null;
    const live = fromStream(stream);
    if (!live) return optimistic ? [...history, optimistic] : history;
    // steer / followUp：新消息排在当前回复之后，其余场景排在回复之前。
    if (optimistic && active?.queued) {
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

/** 本轮任务的主进程投影；不使用界面计时推断执行结果。 */
export function useAppTask(): SessionTask | null {
  const available = useAppAvailable();
  const workspace = useWorkspace(available);
  const [task, setTask] = useState<SessionTask | null>(null);
  useEffect(() => {
    setTask(null);
    const bridge = window.appBridge;
    if (!available || !workspace || !bridge) return;
    const path = `/workspaces/${workspace.id}/sessions/task`;
    const off = bridge.on((frame) => {
      if (frame.type === 'state' && frame.path === path)
        setTask(frame.value as SessionTask | null);
    });
    void bridge.watch([path]);
    return off;
  }, [available, workspace?.id]);
  return task;
}
