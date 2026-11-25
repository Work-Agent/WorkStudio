/**
 * 会话级 agent 注册表。
 *
 * 一个工作区可以同时打开多个会话；每个会话各自持有一个 pi
 * AgentSessionRuntime，因此可以并行执行。键是会话地址键：
 * URL 编码的会话文件，或草稿 id。
 */

import type { SessionAgent } from './session-agent.ts';

export interface SessionAgentInput {
  workspaceId: string;
  path: string;
  /** 打开的会话文件；缺省新建会话。 */
  sessionFile?: string;
  /** 草稿会话的地址键（还没有会话文件时）。 */
  draftKey?: string;
}

export class SessionAgents {
  private readonly byWorkspace = new Map<string, Map<string, SessionAgent>>();

  constructor(
    private readonly create: (
      input: SessionAgentInput,
    ) => Promise<SessionAgent>,
  ) {}

  private workspaceAgents(workspaceId: string): Map<string, SessionAgent> {
    let agents = this.byWorkspace.get(workspaceId);
    if (!agents) {
      agents = new Map();
      this.byWorkspace.set(workspaceId, agents);
    }
    return agents;
  }

  get(workspaceId: string, key: string): SessionAgent | null {
    return this.byWorkspace.get(workspaceId)?.get(key) ?? null;
  }

  keys(workspaceId: string): string[] {
    return [...(this.byWorkspace.get(workspaceId)?.keys() ?? [])];
  }

  /** 找到所属工作区的会话 agent（按地址键）。 */
  find(key: string): { workspaceId: string; agent: SessionAgent } | null {
    for (const [workspaceId, agents] of this.byWorkspace) {
      const agent = agents.get(key);
      if (agent) return { workspaceId, agent };
    }
    return null;
  }

  async ensure(input: SessionAgentInput): Promise<SessionAgent> {
    const agents = this.workspaceAgents(input.workspaceId);
    // 新会话没有文件：直接用草稿键命中。
    if (input.draftKey) {
      const existing = agents.get(input.draftKey);
      if (existing) return existing;
    }
    const agent = await this.create(input);
    agents.set(agent.sessionKey, agent);
    return agent;
  }

  /** 草稿会话拿到会话文件后换地址键（不销毁 agent）。 */
  rekey(workspaceId: string, from: string, to: string): void {
    const agents = this.byWorkspace.get(workspaceId);
    const agent = agents?.get(from);
    if (!agents || !agent) return;
    agents.delete(from);
    agents.set(to, agent);
  }

  async dispose(workspaceId: string, key: string): Promise<void> {
    const agents = this.byWorkspace.get(workspaceId);
    const agent = agents?.get(key);
    if (!agents || !agent) return;
    agents.delete(key);
    agent.dispose();
  }

  async disposeWorkspace(workspaceId: string): Promise<void> {
    const agents = this.byWorkspace.get(workspaceId);
    this.byWorkspace.delete(workspaceId);
    for (const agent of agents?.values() ?? []) agent.dispose();
  }

  entries(): Array<[string, SessionAgent[]]> {
    return [...this.byWorkspace.entries()].map(([workspaceId, agents]) => [
      workspaceId,
      [...agents.values()],
    ]);
  }

  async disposeAll(): Promise<void> {
    for (const workspaceId of Array.from(this.byWorkspace.keys())) {
      await this.disposeWorkspace(workspaceId);
    }
  }
}
