/**
 * shell domain：窗口、视图、主题、布局、对话框与通知。
 *
 * 它们共享同一条窗口生命周期：窗口打开 / 关闭时一起绑定或释放，
 * 因此合并为一个 domain module。对外统一落在 `shell` domain 下。
 */

import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { DomainModule, DomainRegistry } from '../../runtime/domains.ts';
import { AppViews, type AppViewOptions } from './app-views.ts';
import { Dialogs, Notices } from './dialogs.ts';
import { applyLayoutUpdates, bindWindowDomains } from './layout.ts';
import { installMenu } from './menu.ts';
import {
  Scene,
  SystemActions,
  ThemeManager,
  WindowManager,
  type SceneOptions,
  type WindowOptions,
} from './native.ts';
import type { StoragePaths } from '../../runtime/storage/storage-paths.ts';
import { Views } from './views.ts';
import type { ResourcesRuntime } from '../workspace/resources.ts';
import type { ResourcesService } from '../workspace/resources/service.ts';
import { defineNativeDomain } from './native-resource.ts';
import { defineThemeDomain } from './theme.ts';
import { defineWindowsDomain } from './windows.ts';

export interface ShellDomainOptions {
  registry: DomainRegistry;
  storage: StoragePaths;
  window?: WindowOptions;
  scene?: SceneOptions;
  capturePreload?: string;
  appViews: AppViewOptions;
  started(): boolean;
  currentWorkspace(): WorkspaceMeta | null;
  ensureResources(): Promise<ResourcesRuntime>;
  resources(): ResourcesService | null;
  ensureAgent(): Promise<void>;
  openWorkspace(wsId: string): void;
  onThemeSource(source: 'light' | 'dark' | 'system'): void;
}

export class ShellDomain implements DomainModule {
  readonly id = 'shell';

  readonly theme: ThemeManager;
  readonly windows: WindowManager;
  readonly scene: Scene;
  readonly actions: SystemActions;
  readonly views: Views;
  readonly appViews: AppViews;
  readonly dialogs: Dialogs;
  readonly notices: Notices;

  private readonly options: ShellDomainOptions;
  private registry: DomainRegistry | null = null;
  private offLayout: (() => void) | null = null;

  constructor(options: ShellDomainOptions) {
    this.options = options;
    this.theme = new ThemeManager();
    this.windows = new WindowManager(() => this.theme.read());
    this.scene = new Scene(
      options.scene ?? { root: options.storage.workspacesRoot },
    );
    this.actions = new SystemActions(this.windows);
    this.views = new Views(options.registry, this.windows);
    this.appViews = new AppViews({
      views: this.views,
      options: options.appViews,
      started: options.started,
      currentWorkspace: options.currentWorkspace,
      ensureResources: options.ensureResources,
      resources: options.resources,
      ensureAgent: options.ensureAgent,
    });
    this.views.onEmpty((window) => this.appViews.ensureWelcome(window));
    this.dialogs = new Dialogs(options.registry, (visible) =>
      this.setOverlayVisible(visible),
    );
    this.notices = new Notices(options.registry);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    defineThemeDomain(
      registry,
      this.theme,
      this.windows,
      this.options.onThemeSource,
    );
    defineWindowsDomain(
      registry,
      this.windows,
      this.actions,
      this.options.openWorkspace,
    );
    defineNativeDomain(registry, this.actions);
    bindWindowDomains(
      registry,
      this.windows,
      this.scene,
      this.options.capturePreload,
    );
  }

  start(): void {
    this.theme.bind();
    if (this.registry) {
      this.offLayout = applyLayoutUpdates(this.registry, this.windows);
    }
    installMenu(this.windows);
  }

  stop(): void {
    this.offLayout?.();
    this.offLayout = null;
    this.views.dispose();
  }

  setOverlayVisible(visible: boolean): void {
    for (const window of this.windows.list()) {
      for (const view of window.global.list()) {
        if (view.type === 'overlay') window.global.show(view.id, visible);
      }
    }
  }
}
