/**
 * 工作区级 agent runtime 注册表。
 *
 * pi 的 AgentSessionRuntime 是「一个 cwd 一个当前会话」的换代器，
 * 多窗口并发需要按工作区各持一个；这里只负责创建、查找与释放。
 */

import type { WorkspaceAgent } from './workspace-agent.ts';

export class AgentRuntimes {
  private readonly agents = new Map<string, WorkspaceAgent>();

  constructor(
    private readonly create: (
      workspaceId: string,
      path: string,
    ) => Promise<WorkspaceAgent>,
  ) {}

  get(workspaceId: string): WorkspaceAgent | null {
    return this.agents.get(workspaceId) ?? null;
  }

  async ensure(workspaceId: string, path: string): Promise<WorkspaceAgent> {
    const existing = this.agents.get(workspaceId);
    if (existing) return existing;
    const agent = await this.create(workspaceId, path);
    this.agents.set(workspaceId, agent);
    return agent;
  }

  async dispose(workspaceId: string): Promise<void> {
    const agent = this.agents.get(workspaceId);
    if (!agent) return;
    this.agents.delete(workspaceId);
    agent.dispose();
  }

  entries(): Array<[string, WorkspaceAgent]> {
    return [...this.agents.entries()];
  }

  async disposeAll(): Promise<void> {
    for (const workspaceId of Array.from(this.agents.keys())) {
      await this.dispose(workspaceId);
    }
  }
}
