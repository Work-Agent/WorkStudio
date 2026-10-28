/**
 * AppHost（architecture.md §3）。
 *
 * 统一快照 / 命令出口，并维护工作区与会话两级纪元。
 */

import type { AppCommand, AppSnapshot, ScopeEpochs } from '../../shared/app';
import type { CommandResponse } from '../../shared/types';
import { scopeForCommand } from '../../shared/command-scope';
import type { WorkspaceManager } from './workspace-manager';
import type { WorkspaceScope } from './workspace-scope';

export interface AppHostDeps {
  snapshot: (epochs: ScopeEpochs) => Promise<AppSnapshot>;
  dispatch: (command: AppCommand) => Promise<CommandResponse>;
  workspaces: WorkspaceManager;
}

export class AppHost {
  private workspaceEpoch = 0;
  private sessionEpoch = 0;

  constructor(private readonly deps: AppHostDeps) {}

  /** 启动时接管已激活的工作区作用域（不重复激活）。 */
  adoptWorkspace(scope: WorkspaceScope): void {
    this.deps.workspaces.adopt(scope);
  }

  /** 切换工作区：AppHost 统一执行作用域替换与两级 epoch 递增。 */
  switchWorkspace(scope: WorkspaceScope): ScopeEpochs {
    this.deps.workspaces.activate(scope);
    this.workspaceEpoch += 1;
    this.sessionEpoch += 1;
    return this.epochs;
  }

  get workspace(): WorkspaceScope | null {
    return this.deps.workspaces.active;
  }

  get epochs(): ScopeEpochs {
    return {
      workspace: this.workspaceEpoch,
      session: this.sessionEpoch,
    };
  }

  async snapshot(): Promise<AppSnapshot> {
    return this.deps.snapshot(this.epochs);
  }

  async dispatch(command: AppCommand): Promise<CommandResponse> {
    const expected = scopeForCommand(command.action);
    if (command.scope !== expected) {
      return {
        ok: false,
        error: {
          code: 'invalid_scope',
          message: `Command "${command.action}" requires scope "${expected}"`,
        },
      };
    }
    return this.deps.dispatch(command);
  }

  /** 工作区作用域整体替换后调用。 */
  bumpWorkspace(): ScopeEpochs {
    this.workspaceEpoch += 1;
    return this.epochs;
  }

  /** 会话切换后调用。 */
  bumpSession(): ScopeEpochs {
    this.sessionEpoch += 1;
    return this.epochs;
  }
}
