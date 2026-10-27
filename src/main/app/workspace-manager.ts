/**
 * 工作区管理器：当前工作区作用域的切换事务。
 */

import type { WorkspaceScope } from './workspace-scope';

export class WorkspaceManager {
  private current: WorkspaceScope | null = null;

  get active(): WorkspaceScope | null {
    return this.current;
  }

  /** 启动后接管已激活的作用域（不重复销毁 / 激活）。 */
  adopt(scope: WorkspaceScope): void {
    this.current = scope;
  }

  /** 工作区切换：先销毁旧作用域，再激活新作用域。 */
  activate(scope: WorkspaceScope): void {
    this.current?.dispose();
    this.current = scope;
    scope.activate();
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
  }
}
