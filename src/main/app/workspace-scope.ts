/**
 * 工作区作用域。
 *
 * 当前活动工作区的生命周期：激活时绑定 UI 现场并恢复标签；销毁时释放
 * 标签视图、页面会话与写会话。
 */

import type { ViewHost } from '../capabilities/webview/host';
import type { UiStateService } from '../state/ui-state';
import type { PageSessions } from '../ura/page-sessions';
import type { WriteSessionRegistry } from '../ura/sessions';

export interface WorkspaceScopeDeps {
  path: string;
  id: string;
  uiState: UiStateService;
  viewHost: ViewHost;
  pageSessions: PageSessions;
  writeSessions: WriteSessionRegistry;
}

export class WorkspaceScope {
  constructor(private readonly deps: WorkspaceScopeDeps) {}

  get path(): string {
    return this.deps.path;
  }

  get id(): string {
    return this.deps.id;
  }

  activate(): void {
    this.deps.uiState.attachWorkspace(this.deps.id);
    this.deps.viewHost.restore();
  }

  dispose(): void {
    this.deps.viewHost.resetTabs();
    this.deps.pageSessions.disposeAll();
    this.deps.writeSessions.disposeAll();
    this.deps.uiState.flushNow();
  }
}
