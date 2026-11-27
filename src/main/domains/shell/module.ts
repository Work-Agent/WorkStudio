/**
 * shell 模块：窗口宿主（生命周期 + 依赖）。
 *
 * 聚合状态由模块持有，shell 服务只声明资源与命令；
 * Electron 宿主在后续批次以具体实现接入。
 */

import { readScenes, writeScene } from '../../platform/ui-state.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import type { AppearanceStore } from '../../platform/appearance.ts';
import type { PluginFiles } from '../../plugin/files.ts';
import type { Protocols } from '../../protocols.ts';
import type { ShellHost } from './native.ts';
import { createLog } from '../../log.ts';
import { CallFailure } from '../../contract.ts';
import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import {
  createAppearanceState,
  createDialogStates,
  createInteractionState,
  createLayoutState,
  createMenuState,
  createNoticeStates,
  createViewState,
  createWindowState,
  defineAppearanceResource,
  defineDialogsResources,
  defineInteractionResource,
  defineLayoutResources,
  layoutResourceName,
  viewsResourceName,
  defineMenuResource,
  defineNoticesResources,
  defineNativeResource,
  definePagesResource,
  activeWindowId,
  defineViewsResources,
  viewResourceName,
  defineWindowsResource,
} from './domains.ts';

export interface ShellModuleOptions {
  protocols: Protocols;
  appearance: AppearanceStore;
  host?: ShellHost;
  /** 插件文件服务：保存对话框签发 token 用。 */
  files?: PluginFiles;
  storage?: StorageLayout;
}

export class ShellModule implements DomainModule {
  readonly id = 'shell';

  private readonly windows = createWindowState();
  private readonly views = createViewState();
  private readonly layouts = createLayoutState();
  private readonly appearance;
  private readonly interaction = createInteractionState();
  private readonly menu = createMenuState();
  private readonly dialogs = createDialogStates();
  private readonly notices = createNoticeStates();
  private registry: DomainRegistry | null = null;
  private layoutResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private viewResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private dialogResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private noticeResources: {
    ensure: (id: string) => void;
    remove: (id: string) => void;
  } | null = null;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly options: ShellModuleOptions) {
    this.appearance = createAppearanceState(
      options.appearance.read(),
      options.host?.effectiveTheme() ?? 'dark',
    );
    options.host?.applyAppearance(
      this.appearance.theme,
      this.appearance.zoom,
      this.appearance.source,
    );
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    defineWindowsResource(
      registry,
      this.windows,
      this.options.host,
      (windowId) => {
        this.layoutResources?.ensure(windowId);
        this.viewResources?.ensure(windowId);
        this.dialogResources?.ensure(windowId);
        this.noticeResources?.ensure(windowId);
      },
    );
    this.viewResources = defineViewsResources(
      registry,
      this.views,
      this.options.host,
    );
    const storage = this.options.storage;
    this.layoutResources = defineLayoutResources(
      registry,
      this.layouts,
      this.options.host,
      storage
        ? {
            sceneFor: (windowId) => readScenes(storage.uiStateFile)[windowId],
            persist: (windowId, scene) => {
              writeScene(storage.uiStateFile, windowId, scene);
            },
          }
        : {},
    );
    defineNativeResource(registry, this.options.host, this.options.files);
    definePagesResource(registry, this.options.protocols);
    defineAppearanceResource(
      registry,
      this.appearance,
      (settings) => this.options.appearance.write(settings),
      this.options.host,
    );
    defineInteractionResource(registry, this.interaction);
    defineMenuResource(registry, this.menu, this.options.host);
    this.dialogResources = defineDialogsResources(
      registry,
      this.dialogs,
      (windowId, visible) =>
        this.options.host?.setWindowSystemViewVisible(
          windowId,
          'overlay',
          visible,
        ),
    );
    this.noticeResources = defineNoticesResources(registry, this.notices);
  }

  start(): void {
    const host = this.options.host;
    const registry = this.registry;
    if (!host || !registry) return;
    this.offs.push(
      host.onWindowClosed((id) => {
        this.windows.records.delete(id);
        this.layoutResources?.remove(id);
        this.viewResources?.remove(id);
        this.dialogResources?.remove(id);
        this.noticeResources?.remove(id);
        this.registry?.define('shell').resource('windows').publish();
      }),
      // 窗口尺寸变化：按新尺寸重算布局（原生视图与 DOM 共用同一份快照）。
      host.onWindowResized((id) => {
        void registry.dispatchCommand(
          { domain: 'shell', resource: layoutResourceName(id) },
          'resize',
          {},
          {
            origin: { type: 'service', id: 'shell' },
            changed: (ref, type) => registry.changed(ref, type),
            log: createLog('shell'),
          },
        );
      }),
      host.onWindowActivated((id) => {
        for (const [key, record] of this.windows.records) {
          this.windows.records.set(key, {
            ...record,
            active: key === id,
          });
        }
        this.registry?.define('shell').resource('windows').publish();
      }),
      host.onViewClosed((windowId, viewId) => {
        this.views.records.get(windowId)?.delete(viewId);
        this.registry
          ?.define('shell')
          .remove(viewResourceName(windowId, viewId));
        this.registry
          ?.define('shell')
          .resource(viewsResourceName(windowId))
          .publish();
      }),
      // 跟随系统时 state.theme 只能由平台事件刷新；显式 light/dark 忽略系统变化。
      host.onSystemThemeChanged((theme) => {
        if (this.appearance.source !== 'system') return;
        if (this.appearance.theme === theme) return;
        this.appearance.theme = theme;
        this.registry?.define('shell').resource('appearance').patch({ theme });
      }),
    );
  }

  stop(): void {
    this.windows.records.clear();
    for (const windowId of this.views.records.keys()) {
      this.viewResources?.remove(windowId);
    }
    this.views.records.clear();
    this.viewResources = null;
    for (const id of this.layouts.records.keys())
      this.layoutResources?.remove(id);
    this.layouts.records.clear();
    this.layoutResources = null;
    this.appearance.theme = 'dark';
    this.appearance.source = 'system';
    this.appearance.zoom = 1;
    this.interaction.session = null;
    this.menu.items = [];
    for (const windowId of Array.from(this.dialogs.byWindow.keys())) {
      this.dialogResources?.remove(windowId);
    }
    for (const windowId of Array.from(this.notices.byWindow.keys())) {
      this.noticeResources?.remove(windowId);
    }
    this.dialogs.byWindow.clear();
    this.notices.byWindow.clear();
    this.dialogResources = null;
    this.noticeResources = null;

    for (const off of this.offs.splice(0)) off();
    this.registry = null;
  }
}
