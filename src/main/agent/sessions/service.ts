import type { SessionTask } from '../../../shared/session-task.ts';
import { fileRef } from '../../../shared/ura.ts';
import { resolve } from 'node:path';
/**
 * 会话业务：持有会话状态与操作，不认路径、不碰 ctx。
 *
 * 状态与操作在类上；路径绑定在 routes.ts。
 */

import type { AgentHost } from '../agent-host.ts';
import type {
  AgentSnapshot,
  ModelOption,
  ParsedMessage,
  PiEventFrame,
  PiSessionEvent,
  SessionMeta,
} from '../../../shared/types.ts';

export interface SessionListItem extends SessionMeta {
  id: string;
}

export interface PromptInput {
  text: string;
  newSession?: boolean;
  activeSkills?: string[];
}

export interface SessionToolState {
  id: string;
  name: string;
  args: unknown;
  result: unknown;
  isError: boolean;
  done: boolean;
}

/** 当前回复的完整投影：状态是权威，事件是增量提示。 */
export interface SessionStreamState {
  streaming: boolean;
  text: string;
  thinking: string;
  tools: SessionToolState[];
}

/** 受约束的流式增量：type 是唯一判别字段，channel 是封闭枚举。 */
export type SessionStreamEvent =
  | { type: 'message-start'; role: string }
  | { type: 'message-end'; role: string }
  | { type: 'append'; channel: 'text' | 'thinking'; delta: string }
  | { type: 'tool-start'; id: string; name: string; args: unknown }
  | { type: 'tool-end'; id: string; result: unknown; isError: boolean }
  | { type: 'settled' };

export function isSessionStreamEvent(
  value: unknown,
): value is SessionStreamEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  switch (event['type']) {
    case 'message-start':
    case 'message-end':
      return typeof event['role'] === 'string';
    case 'append':
      return (
        (event['channel'] === 'text' || event['channel'] === 'thinking') &&
        typeof event['delta'] === 'string'
      );
    case 'tool-start':
      return (
        typeof event['id'] === 'string' && typeof event['name'] === 'string'
      );
    case 'tool-end':
      return (
        typeof event['id'] === 'string' && typeof event['isError'] === 'boolean'
      );
    case 'settled':
      return true;
    default:
      return false;
  }
}

function idleStream(): SessionStreamState {
  return { streaming: false, text: '', thinking: '', tools: [] };
}

const idOf = (path: string): string => encodeURIComponent(path);
const pathOf = (id: string): string => decodeURIComponent(id);

export class SessionsService {
  private listView: SessionListItem[] = [];
  private taskView: SessionTask | null = null;
  private taskSeq = 0;
  private stopRequestedTask: number | null = null;
  private taskStartSeq = 0;
  private lastActiveFile: string | null = null;
  private lastInput: PromptInput | null = null;
  private readonly openedFiles = new Set<string>();
  get task(): SessionTask | null {
    return this.taskView ? structuredClone(this.taskView) : null;
  }
  get opened(): string[] {
    const file = this.currentView?.sessionFile;
    if (file !== this.lastActiveFile) {
      this.lastActiveFile = file ?? null;
      if (file) this.openedFiles.add(file);
    }
    return [...this.openedFiles];
  }
  closeTabs(paths: string[]): void {
    for (const path of paths) this.openedFiles.delete(path);
    this.emitChange();
  }
  private currentView: AgentSnapshot | null = null;
  private readonly messageViews = new Map<string, ParsedMessage[]>();
  private readonly changeListeners = new Set<() => void>();
  private readonly streamListeners = new Set<
    (sessionId: string, state: SessionStreamState) => void
  >();
  private readonly streamEventListeners = new Set<
    (sessionId: string, event: SessionStreamEvent) => void
  >();
  private readonly streamViews = new Map<string, SessionStreamState>();
  /** 流式世代：旧回调不得清理新流。 */
  private streamEpoch = 0;

  constructor(private readonly agent: AgentHost) {}

  get list(): SessionListItem[] {
    return this.listView;
  }

  get current(): AgentSnapshot | null {
    return this.currentView;
  }

  messages(sessionId: string): ParsedMessage[] {
    return this.messageViews.get(sessionId) ?? [];
  }

  models(): ModelOption[] {
    return this.agent.getModels();
  }

  commands(): Array<{ name: string; description: string; source: string }> {
    return this.agent.getCommands();
  }

  stream(sessionId: string): SessionStreamState {
    return this.streamViews.get(sessionId) ?? idleStream();
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onStream(
    listener: (sessionId: string, state: SessionStreamState) => void,
  ): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  onStreamEvent(
    listener: (sessionId: string, event: SessionStreamEvent) => void,
  ): () => void {
    this.streamEventListeners.add(listener);
    return () => this.streamEventListeners.delete(listener);
  }

  async start(): Promise<void> {
    this.currentView = this.agent.getSnapshot();
    await this.refresh();
    await this.loadMessages();
    this.emitChange();
  }

  async refresh(): Promise<void> {
    const items = await this.agent.listSessions();
    this.listView = items.map((item) => ({ ...item, id: idOf(item.path) }));
    this.emitChange();
  }

  /** 工作区换代：重新绑定当前会话、列表与消息。 */
  async reloadWorkspace(): Promise<void> {
    this.openedFiles.clear();
    this.lastActiveFile = null;
    this.taskView = null;
    this.lastInput = null;
    this.currentView = this.agent.getSnapshot();
    this.streamEpoch += 1;
    this.messageViews.clear();
    this.streamViews.clear();
    await this.refresh();
    await this.loadMessages();
    this.emitChange();
  }

  private requireIdle(): void {
    if (
      this.taskView &&
      ['running', 'stopping', 'unconfirmed'].includes(this.taskView.status)
    )
      throw new Error('请先停止当前任务并等待确认，再切换会话');
  }

  async newSession(): Promise<void> {
    this.requireIdle();
    await this.agent.newSession();
    this.currentView = this.agent.getSnapshot();
    this.resetStream(this.currentView.sessionFile);
    await this.loadMessages();
    await this.refresh();
    this.emitChange();
  }

  async openSession(sessionId: string): Promise<void> {
    const path = pathOf(sessionId);
    if (path === this.currentView?.sessionFile) {
      this.openedFiles.add(path);
      this.emitChange();
      return;
    }
    this.requireIdle();
    this.openedFiles.add(path);
    await this.agent.switchSession(path);
    this.currentView = this.agent.getSnapshot();
    this.resetStream(this.currentView.sessionFile);
    await this.loadMessages(path);
    await this.refresh();
    this.emitChange();
  }

  async prompt(input: PromptInput, retry = false): Promise<void> {
    if (
      this.taskView &&
      ['running', 'stopping', 'unconfirmed'].includes(this.taskView.status)
    )
      throw new Error('当前任务尚未结束');
    const task: SessionTask = {
      id: ++this.taskSeq,
      sessionFile: input.newSession
        ? null
        : this.agent.getSnapshot().sessionFile,
      status: 'running',
      request: input.text,
      attempt: retry ? (this.taskView?.attempt ?? 0) + 1 : 1,
      stage: '正在连接模型',
      error: null,
      mayHaveSideEffects: false,
      artifacts: [],
      tools: [],
    };
    this.taskStartSeq = this.agent.currentSeq ?? 0;
    this.taskView = task;
    this.lastInput = { ...input };
    this.emitChange();
    try {
      await this.agent.prompt(input);
      const streaming = this.agent.getSnapshot().isStreaming;
      if (['stopping', 'unconfirmed'].includes(task.status)) {
        task.status = streaming ? 'unconfirmed' : 'stopped';
        task.stage = streaming ? '尚未确认停止，请等待执行结果' : '本轮已停止';
      } else if (task.status === 'running') {
        task.status = streaming
          ? 'unconfirmed'
          : task.tools.some((tool) => tool.error)
            ? 'failed'
            : 'done';
        task.stage =
          task.status === 'unconfirmed'
            ? '尚未确认执行结束，请等待执行结果'
            : task.status === 'failed'
              ? '本轮结束，有工具步骤失败，请检查'
              : '本轮执行结束，请检查结果';
      }
    } catch (error) {
      if (
        this.stopRequestedTask === task.id &&
        !this.agent.getSnapshot().isStreaming
      ) {
        task.status = 'stopped';
        task.stage = '本轮已停止';
      } else {
        task.status = 'failed';
        task.stage = '本轮未完成';
        task.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.currentView = this.agent.getSnapshot();
      if (!task.sessionFile) task.sessionFile = this.currentView.sessionFile;
      await this.refresh();
      this.emitChange();
    }
  }

  async retry(confirmed = false): Promise<void> {
    if (
      !this.taskView ||
      !['failed', 'stopped'].includes(this.taskView.status) ||
      !this.lastInput
    )
      throw new Error('当前没有可重试的任务');
    if (
      this.taskView.sessionFile &&
      this.taskView.sessionFile !== this.agent.getSnapshot().sessionFile
    )
      throw new Error('请先打开原会话再重试');
    if (this.taskView.mayHaveSideEffects && !confirmed)
      throw new Error(
        '本轮可能已有文件操作，请先检查成果，再确认重新执行原请求',
      );
    await this.prompt({ ...this.lastInput, newSession: false }, true);
  }

  async steer(text: string): Promise<void> {
    await this.agent.steer(text);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  async followUp(text: string): Promise<void> {
    await this.agent.followUp(text);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  async abort(): Promise<void> {
    const task = this.taskView;
    if (task && ['running', 'unconfirmed'].includes(task.status)) {
      this.stopRequestedTask = task.id;
      task.status = 'stopping';
      task.stage = '已请求停止，正在等待当前操作返回';
      this.emitChange();
    }
    try {
      await this.agent.abort();
      this.currentView = this.agent.getSnapshot();
      if (task && task.status === 'stopping') {
        task.status = this.currentView.isStreaming ? 'unconfirmed' : 'stopped';
        task.stage = this.currentView.isStreaming
          ? '尚未确认停止，请等待执行结果'
          : '本轮已停止；已完成的操作不会撤销';
      }
    } catch (error) {
      if (task) {
        task.status = 'unconfirmed';
        task.stage = '未能确认停止';
        task.error = error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      this.emitChange();
    }
  }

  async compact(instructions?: string): Promise<void> {
    await this.agent.compact(instructions);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  async fork(
    entryId: string,
    position?: 'before' | 'at',
  ): Promise<{ cancelled: boolean }> {
    this.requireIdle();
    const result = await this.agent.fork(entryId, position);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
    return result;
  }

  rename(sessionId: string, name: string): void {
    this.agent.renameSession(pathOf(sessionId), name);
    this.currentView = this.agent.getSnapshot();
    void this.refresh();
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.requireIdle();
    await this.agent.deleteSession(pathOf(sessionId));
    this.streamViews.delete(sessionId);
    this.currentView = this.agent.getSnapshot();
    await this.refresh();
    this.emitChange();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.agent.setModel(provider, modelId);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  setThinking(level: string): void {
    this.agent.setThinkingLevel(level);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  setSteeringMode(mode: 'all' | 'one-at-a-time'): void {
    this.agent.setSteeringMode(mode);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  setFollowUpMode(mode: 'all' | 'one-at-a-time'): void {
    this.agent.setFollowUpMode(mode);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  setAutoCompaction(enabled: boolean): void {
    this.agent.setAutoCompaction(enabled);
    this.currentView = this.agent.getSnapshot();
    this.emitChange();
  }

  reloadResources(): void {
    void this.agent.reloadResources();
  }

  /** 组合根把 AgentHost 的帧送进来；归约成当前回复状态，并发出受约束的增量。 */
  receiveFrame(frame: PiEventFrame): void {
    const snapshot = this.agent.getSnapshot();
    this.currentView = snapshot;
    // 状态类内部事件（应用默认模型 / 思考档位等）只改快照，不带流式增量。
    // 必须在这里重新发布当前会话状态：否则设置页与助手面板会一直停留在
    // 「未配置模型」之类的旧投影上，直到某个偶然的 refresh 才对齐。
    if (frame.event.type === 'agent_status_changed') {
      this.emitChange();
      return;
    }
    const file = snapshot.sessionFile;
    if (!file) return;

    const sessionId = idOf(file);
    const task = this.taskView;
    if (task && !task.sessionFile) task.sessionFile = file;
    if (task && task.sessionFile === file && frame.seq > this.taskStartSeq) {
      const event = frame.event;
      if (event.type === 'tool_execution_start') {
        const ev = event as {
          toolCallId: string;
          toolName: string;
          args: unknown;
        };
        task.tools.push({
          id: ev.toolCallId,
          name: ev.toolName,
          done: false,
          error: false,
        });
        if (task.status === 'running') task.stage = `正在执行 ${ev.toolName}`;
        if (
          /(write|edit|bash|exec|delete|remove|move|rename|create)/i.test(
            ev.toolName,
          )
        )
          task.mayHaveSideEffects = true;
      } else if (event.type === 'tool_execution_end') {
        const ev = event as {
          toolCallId: string;
          toolName?: string;
          isError: boolean;
        };
        const tool = task.tools.find((item) => item.id === ev.toolCallId);
        if (tool) {
          tool.done = true;
          tool.error = ev.isError;
        }
        if (ev.isError && task.status === 'done') task.status = 'failed';
        if (
          task.status === 'running' ||
          (ev.isError && task.status === 'failed')
        )
          task.stage = ev.isError
            ? '工具步骤失败，请检查执行详情'
            : '继续处理任务';
        const previousTool = this.stream(sessionId).tools.find(
          (item) => item.id === ev.toolCallId,
        );
        if (tool && !ev.isError && ['write', 'edit'].includes(tool.name)) {
          const args = previousTool?.args as
            | { ref?: string; path?: string }
            | undefined;
          const target = args?.ref ?? args?.path;
          if (target) {
            const ref = /^[a-z][a-z0-9+.-]*:/i.test(target)
              ? target
              : fileRef(
                  resolve(
                    snapshot.workspacePath ?? snapshot.cwd ?? '.',
                    target,
                  ),
                );
            if (!task.artifacts.some((item) => item.ref === ref))
              task.artifacts.push({
                ref,
                label: decodeURIComponent(ref.split('/').pop() ?? ref),
              });
          }
        }
      } else if (event.type === 'error') {
        if (this.stopRequestedTask !== task.id) {
          task.error = String(
            (event as { message?: string }).message ?? '执行失败',
          );
          if (task.status !== 'stopping') {
            task.status = 'failed';
            task.stage = '本轮执行失败';
          }
        }
      }
      this.emitChange();
    }
    const prev = this.stream(sessionId);
    let next: SessionStreamState | null = null;
    let event: SessionStreamEvent | null = null;

    switch (frame.event.type) {
      case 'message_start': {
        this.streamEpoch += 1;
        next = { streaming: true, text: '', thinking: '', tools: [] };
        this.emitChange();
        // 新会话首轮：用户消息可能早于会话文件就绪而被跳过，这里补一次历史同步。
        if (frame.event.message.role !== 'user') void this.syncMessages();
        event = {
          type: 'message-start',
          role: frame.event.message.role,
        };
        break;
      }
      case 'message_update': {
        const inner = frame.event.assistantMessageEvent;
        if (inner.type === 'text_delta' && inner.delta) {
          next = {
            ...prev,
            streaming: true,
            text: prev.text + inner.delta,
          };
          event = { type: 'append', channel: 'text', delta: inner.delta };
        } else if (inner.type === 'thinking_delta' && inner.delta) {
          next = {
            ...prev,
            streaming: true,
            thinking: prev.thinking + inner.delta,
          };
          event = {
            type: 'append',
            channel: 'thinking',
            delta: inner.delta,
          };
        } else if (
          inner.type === 'text_end' &&
          typeof inner.content === 'string'
        ) {
          next = { ...prev, text: inner.content };
        } else if (
          inner.type === 'thinking_end' &&
          typeof inner.content === 'string'
        ) {
          next = { ...prev, thinking: inner.content };
        }
        break;
      }
      case 'tool_execution_start': {
        const ev = frame.event as Extract<
          PiSessionEvent,
          { type: 'tool_execution_start' }
        >;
        next = {
          ...prev,
          streaming: true,
          tools: [
            ...prev.tools,
            {
              id: ev.toolCallId,
              name: ev.toolName,
              args: ev.args,
              result: null,
              isError: false,
              done: false,
            },
          ],
        };
        event = {
          type: 'tool-start',
          id: ev.toolCallId,
          name: ev.toolName,
          args: ev.args,
        };
        break;
      }
      case 'tool_execution_end': {
        const ev = frame.event as Extract<
          PiSessionEvent,
          { type: 'tool_execution_end' }
        >;
        next = {
          ...prev,
          tools: prev.tools.map((tool) =>
            tool.id === ev.toolCallId
              ? {
                  ...tool,
                  result: ev.result,
                  isError: ev.isError,
                  done: true,
                }
              : tool,
          ),
        };
        event = {
          type: 'tool-end',
          id: ev.toolCallId,
          result: ev.result,
          isError: ev.isError,
        };
        break;
      }
      case 'message_end':
        event = {
          type: 'message-end',
          role: frame.event.message.role,
        };
        this.emitChange();
        void this.syncMessages();
        break;
      case 'agent_settled': {
        next = { ...prev, streaming: false };
        event = { type: 'settled' };
        this.emitChange();
        // 等历史同步后再收起流式状态。
        const epoch = ++this.streamEpoch;
        void this.syncMessages().then(() => {
          if (epoch !== this.streamEpoch) return;
          if (this.stream(sessionId).streaming) return;
          const idle = idleStream();
          this.streamViews.set(sessionId, idle);
          for (const listener of this.streamListeners) {
            listener(sessionId, idle);
          }
          this.emitChange();
        });
        break;
      }
      default:
        break;
    }

    if (next) {
      this.streamViews.set(sessionId, next);
      for (const listener of this.streamListeners) listener(sessionId, next);
    }
    if (event) {
      for (const listener of this.streamEventListeners) {
        listener(sessionId, event);
      }
    }
  }

  private resetStream(file: string | null): void {
    if (!file) return;
    this.streamEpoch += 1;
    const sessionId = idOf(file);
    const state = idleStream();
    this.streamViews.set(sessionId, state);
    for (const listener of this.streamListeners) listener(sessionId, state);
  }

  private async syncMessages(): Promise<void> {
    const file =
      this.currentView?.sessionFile ?? this.agent.getSnapshot().sessionFile;
    if (!file) return;
    this.messageViews.set(idOf(file), await this.agent.getMessages(file));
    this.emitChange();
  }

  private async loadMessages(path?: string): Promise<void> {
    const file = path ?? this.agent.getSnapshot().sessionFile ?? '';
    if (!file) return;
    this.messageViews.set(idOf(file), await this.agent.getMessages(file));
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
