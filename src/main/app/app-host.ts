/**
 * AppHost（architecture.md §3）。
 *
 * 统一快照 / 命令出口，并维护工作区与会话两级纪元。
 */

import type { AppCommand, AppSnapshot, ScopeEpochs } from '../../shared/app';
import type { CommandResponse } from '../../shared/types';

export interface AppHostDeps {
  snapshot: (epochs: ScopeEpochs) => Promise<AppSnapshot>;
  dispatch: (command: AppCommand) => Promise<CommandResponse>;
}

export class AppHost {
  private workspaceEpoch = 0;
  private sessionEpoch = 0;

  constructor(private readonly deps: AppHostDeps) {}

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
