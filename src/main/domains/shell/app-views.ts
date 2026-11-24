import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { PluginSurface } from '../workspace/plugins.ts';
import type { ResourcesRuntime } from '../workspace/resources.ts';
import type { ResourcesService } from '../workspace/resources/service.ts';
import type { WorkspaceWindow } from './native.ts';
import type { Views } from './views.ts';

export interface AppViewOptions {
  rendererPage?: (
    page: 'index' | 'assistant' | 'overlay' | 'settings' | 'welcome',
  ) => string;
  preloads?: {
    extension?: string;
    browser?: string;
    assistant?: string;
    overlay?: string;
    settings?: string;
  };
}

/** 内容视图 / 系统视图的打开入口；App 只提供当前 workspace 与运行时依赖。 */
export class AppViews {
  constructor(
    private readonly deps: {
      views: Views;
      options: AppViewOptions;
      started(): boolean;
      currentWorkspace(): WorkspaceMeta | null;
      ensureResources(): Promise<ResourcesRuntime>;
      resources(): ResourcesService | null;
      ensureAgent(): Promise<void>;
    },
  ) {}

  openWelcome(): Promise<{ id: string }> {
    const workspace = this.deps.currentWorkspace();
    if (!workspace) return Promise.reject(new Error('no workspace'));
    return this.deps.views
      .open(workspace.id, 'welcome', { type: 'welcome' })
      .then((view) => ({ id: view.id }));
  }

  ensureWelcome(window: WorkspaceWindow): void {
    if (!this.deps.started() || !this.deps.options.rendererPage) return;
    if (!window.current()) return;
    if (window.tabs.findByContentPath('/welcome')) return;
    void this.deps.views
      .open(window.wsId, 'welcome', { type: 'welcome' })
      .catch((error: unknown) => {
        console.error('[app] welcome open failed', error);
      });
  }

  openSettings(pageId: string): Promise<{ id: string }> {
    if (pageId === 'welcome') return this.openWelcome();
    const workspace = this.deps.currentWorkspace();
    if (!workspace) return Promise.reject(new Error('no workspace'));
    void this.deps.ensureResources().catch((error: unknown) => {
      console.error('[app] settings resources init failed', error);
    });
    void this.deps.ensureAgent().catch((error: unknown) => {
      console.error('[app] settings agent init failed', error);
    });
    return this.deps.views
      .open(workspace.id, 'settings', { type: 'settings', pageId })
      .then((view) => ({ id: view.id }));
  }

  openPlugin(
    pluginId: string,
    surface: PluginSurface,
  ): Promise<{ id: string }> {
    const workspace = this.deps.currentWorkspace();
    if (!workspace) return Promise.reject(new Error('no workspace'));
    return this.deps.views
      .open(workspace.id, 'plugins', {
        type: 'plugin',
        pluginId,
        surface,
      })
      .then((view) => ({ id: view.id }));
  }

  async openResourcePageView(ref: string): Promise<{
    type: 'page' | 'browser';
    pageId?: string;
    viewId?: string;
    url?: string;
  }> {
    const runtime = await this.deps.ensureResources();
    const result = await runtime.service.openPage(ref);
    if (result.type === 'browser') {
      const view = await this.openWeb(result.url, result.url);
      return { type: 'browser', url: result.url, viewId: view.id };
    }
    const view = await this.openResource(ref);
    return { type: 'page', pageId: result.info.id, viewId: view.id };
  }

  async savePageCopy(
    pageId: string,
    content: string | Uint8Array,
  ): Promise<{ saved: boolean; ref?: string }> {
    const runtime = await this.deps.ensureResources();
    const page = runtime.service.page(pageId);
    if (!page) throw new Error('资源页面会话不存在');
    const slash = page.ref.lastIndexOf('/');
    const dot = page.ref.lastIndexOf('.');
    const ext = dot > slash ? page.ref.slice(dot) : '';
    const ref = `${page.ref.slice(0, dot > slash ? dot : page.ref.length)}.copy${ext}`;
    await runtime.service.write(ref, content);
    return { saved: true, ref };
  }

  openWeb(url: string, title?: string): Promise<{ id: string }> {
    const workspace = this.deps.currentWorkspace();
    if (!workspace) throw new Error('no workspace');
    return this.deps.views
      .open(workspace.id, 'browser', { type: 'web', url, title })
      .then((view) => ({ id: view.id }));
  }

  openResource(ref: string): Promise<{ id: string }> {
    const workspace = this.deps.currentWorkspace();
    if (!workspace) throw new Error('no workspace');
    return this.deps.views
      .open(workspace.id, 'resources', { type: 'resource', ref })
      .then((view) => ({ id: view.id }));
  }

  ensureAssistant(window: WorkspaceWindow): void {
    const options = this.deps.options;
    if (!options.rendererPage || !options.preloads?.assistant) return;
    if (window.global.list().some((view) => view.type === 'assistant')) return;
    window.global.create({
      type: 'assistant',
      title: 'AI 助手',
      url: options.rendererPage('assistant'),
      preload: options.preloads.assistant,
    });
  }

  ensureOverlay(window: WorkspaceWindow): void {
    const options = this.deps.options;
    if (!options.rendererPage || !options.preloads?.overlay) return;
    if (window.global.list().some((view) => view.type === 'overlay')) return;
    window.global.create({
      type: 'overlay',
      title: '对话框',
      url: options.rendererPage('overlay'),
      preload: options.preloads.overlay,
    });
  }
}
