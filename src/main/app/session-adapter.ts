/**
 * 会话适配（Phase 3）。
 *
 * pi 拥有会话生命周期；本适配只做三件事：
 *   1. 会话切换 / 新建 / 分支委托 pi；
 *   2. 按会话保存技能激活集，并在载入会话时应用；
 *   3. 会话作用域变化时通知 AppHost 递增 epoch。
 */

import type { AgentHost } from '../agent/agent-host';
import type { SkillsManager } from '../harness/skills';

export interface SessionAdapterDeps {
  agent: AgentHost;
  skills: SkillsManager;
  /** 新会话 / 未记录会话的默认激活集。 */
  defaultSkills: () => string[];
  /** 会话作用域变化（切换 / 新建 / 分支）。 */
  onChanged: () => void;
}

export class SessionAdapter {
  private readonly activeBySession = new Map<string, string[]>();

  constructor(private readonly deps: SessionAdapterDeps) {}

  get currentPath(): string | null {
    return this.deps.agent.getSnapshot().sessionFile;
  }

  getActiveSkills(path: string | null = this.currentPath): string[] {
    return [
      ...(this.activeBySession.get(path ?? '') ?? this.deps.defaultSkills()),
    ];
  }

  setActiveSkills(
    names: string[],
    path: string | null = this.currentPath,
  ): void {
    this.activeBySession.set(path ?? '', [...names]);
  }

  async switchSession(
    path: string,
  ): Promise<Awaited<ReturnType<AgentHost['switchSession']>>> {
    const result = await this.deps.agent.switchSession(path);
    await this.applySkills(this.getActiveSkills(path));
    this.deps.onChanged();
    return result;
  }

  async newSession(): Promise<void> {
    await this.deps.agent.newSession();
    await this.applySkills(this.getActiveSkills(this.currentPath));
    this.deps.onChanged();
  }

  async fork(
    entryId: string,
    position?: 'before' | 'at',
  ): Promise<Awaited<ReturnType<AgentHost['fork']>>> {
    const result = await this.deps.agent.fork(entryId, position);
    await this.applySkills(this.getActiveSkills(this.currentPath));
    this.deps.onChanged();
    return result;
  }

  async prompt(params: {
    text: string;
    newSession?: boolean;
    activeSkills?: string[];
  }): Promise<void> {
    if (params.activeSkills) this.setActiveSkills(params.activeSkills);
    await this.deps.agent.prompt(params);
    const nextPath = this.currentPath;
    if (params.activeSkills) {
      this.activeBySession.set(nextPath ?? '', [...params.activeSkills]);
    }
    if (params.newSession) this.deps.onChanged();
  }

  private async applySkills(names: string[]): Promise<void> {
    const current = this.deps.skills.getActive();
    if (sameSet(current, names)) return;
    this.deps.skills.setActive(names);
    await this.deps.agent.reloadResources();
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
