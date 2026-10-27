/**
 * AppHost 骨架（architecture.md §3）。
 *
 * Phase 1：统一快照 / 命令 / 事件出口；作用域与切换在后续阶段迁入。
 */

import type {
  AppCommand,
  AppEvent,
  AppSnapshot,
  ScopeEpochs,
} from '../../shared/app';
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

  /** 事件出口占位：Phase 6 由作用域事件桥注入。 */
  event<T>(event: AppEvent<T>): AppEvent<T> {
    return event;
  }
}
