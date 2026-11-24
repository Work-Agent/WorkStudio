/**
 * Session：Session 作用域的状态切片。
 *
 * 模型上下文、消息、轮次、队列与技能激活都随会话切换；
 * 事件绑定由 agent 服务负责，页面订阅不重建。
 */

import { notImplemented } from '../../contract.ts';
import type { AgentContext } from './context.ts';

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  at: number;
}

export interface SessionTurn {
  id: string;
  status: 'running' | 'done' | 'aborted';
  at: number;
}

export interface SessionModel {
  provider: string;
  id: string;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  messages: SessionMessage[];
  turns: SessionTurn[];
  queue: string[];
  streaming: boolean;
  model: SessionModel | null;
}

export class Session {
  readonly id: string;
  readonly context: AgentContext;

  private messages: SessionMessage[] = [];
  private turns: SessionTurn[] = [];
  private queue: string[] = [];
  private model: SessionModel | null = null;
  private title: string;

  constructor(id: string, context: AgentContext, title = id) {
    this.id = id;
    this.context = context;
    this.title = title;
  }

  get name(): string {
    return this.title;
  }

  snapshot(): SessionSnapshot {
    return {
      id: this.id,
      title: this.title,
      messages: [...this.messages],
      turns: [...this.turns],
      queue: [...this.queue],
      streaming: this.turns.some((turn) => turn.status === 'running'),
      model: this.model,
    };
  }

  setModel(provider: string, modelId: string): void {
    this.model = { provider, id: modelId };
  }

  async prompt(_text: string): Promise<void> {
    notImplemented('agent/session/prompt');
  }

  async steer(_text: string): Promise<void> {
    notImplemented('agent/session/steer');
  }

  async followUp(_text: string): Promise<void> {
    notImplemented('agent/session/followUp');
  }

  async abort(): Promise<void> {
    notImplemented('agent/session/abort');
  }

  async compact(_instructions?: string): Promise<void> {
    notImplemented('agent/session/compact');
  }

  async retry(_confirmed = false): Promise<void> {
    notImplemented('agent/session/retry');
  }

  async fork(_entryId: string, _position: 'before' | 'after'): Promise<void> {
    notImplemented('agent/session/fork');
  }

  rename(name: string): void {
    const normalized = name.trim();
    if (normalized) this.title = normalized;
  }
}
