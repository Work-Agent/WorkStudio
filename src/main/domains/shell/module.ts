/**
 * shell 模块：窗口宿主（生命周期 + 依赖）。
 *
 * 聚合状态由模块持有，shell 服务只声明资源与命令；
 * Electron 宿主在后续批次以具体实现接入。
 */

import { readScenes, writeScene } from '../../platform/ui-state.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import type { AppearanceStore } from '../../platform/appearance.ts';
import type { Protocols } from '../../protocols.ts';
import type { ShellHost } from './native.ts';
import { createLog } from '../../log.ts';
import { CallFailure } from '../../contract.ts';
import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import {
  createAppearanceState,
  createDialogState,
  createInteractionState,
  createLayoutState,
  createMenuState,
  createNoticeState,
  createViewState,
  createWindowState,
  defineAppearanceResource,
  defineDialogsResource,
  defineInteractionResource,
  defineLayoutResource,
  defineMenuResource,
  defineNoticesResource,
  defineNativeResource,
  definePagesResource,
  defineViewsResource,
  defineWindowsResource,
} from './domains.ts';

export interface ShellModuleOptions {
  protocols: Protocols;
  appearance: AppearanceStore;
  host?: ShellHost;
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
  private readonly dialogs = createDialogState();
  private readonly notices = createNoticeState();
  private registry: DomainRegistry | null = null;
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
        void this.registry?.dispatchCommand(
          { domain: 'shell', resource: 'layout' },
          'ensure',
          { windowId },
          {
            origin: { type: 'service', id: 'shell' },
            changed: () => undefined,
            log: createLog('shell'),
          },
        );
      },
    );
    defineViewsResource(registry, this.views, this.options.host);
    const storage = this.options.storage;
    defineLayoutResource(
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
    defineNativeResource(registry, this.options.host);
    definePagesResource(registry, this.options.protocols, async (url) => {
      const result = await registry.dispatchCommand(
        { domain: 'shell', resource: 'views' },
        'open',
        {
          id: url,
          type: 'page',
          title: url,
          url,
        },
        {
          origin: { type: 'service', id: 'shell' },
          changed: (ref, type) => registry.changed(ref, type),
          log: createLog('shell'),
        },
      );
      if (!result.ok)
        throw new CallFailure(result.error.code, result.error.message);
      return result.data;
    });
    defineAppearanceResource(
      registry,
      this.appearance,
      (settings) => this.options.appearance.write(settings),
      this.options.host,
    );
    defineInteractionResource(registry, this.interaction);
    defineMenuResource(registry, this.menu, this.options.host);
    defineDialogsResource(registry, this.dialogs, (visible) =>
      this.options.host?.setSystemViewVisible('overlay', visible),
    );
    defineNoticesResource(registry, this.notices);
  }

  start(): void {
    const host = this.options.host;
    if (!host) return;
    this.offs.push(
      host.onWindowClosed((id) => {
        this.windows.records.delete(id);
        this.registry?.define('shell').resource('windows').publish();
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
      host.onViewClosed((id) => {
        this.views.records.delete(id);
        this.registry?.define('shell').remove(`view/${id}`);
        this.registry?.define('shell').resource('views').publish();
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
    this.views.records.clear();
    this.layouts.records.clear();
    this.appearance.theme = 'dark';
    this.appearance.source = 'system';
    this.appearance.zoom = 1;
    this.interaction.session = null;
    this.menu.items = [];
    this.dialogs.records.clear();
    this.notices.notices = [];
    for (const off of this.offs.splice(0)) off();
    this.registry = null;
  }
}
