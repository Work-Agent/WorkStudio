/**
 * App 组合根（App 作用域）。
 *
 *   registry/   DomainRegistry：域注册 · 生命周期 · 分发 · 订阅
 *   ipc/        origins · dispatcher · ipc 通道（bridge 契约在 src/preload）
 *   composition.ts  模块的唯一组合入口（App 不认识具体模块）
 *   domains/    shell · workspace · plugin · settings · browser · agent
 *   plugin/     manifest · contribution · context · manager · lifecycle
 *   transport/  ResourceAdapter · 工作区文件 · 网页缓存
 *   protocols.ts  scheme 注册与 host → 页面文件
 *
 * App 只装配基础设施并调用 DomainRegistry.start / stop；
 * 不持有具体域，也不调用域的方法。
 */

import type { DomainUpdate } from './contract.ts';
import type { ListItem } from '../shared/lists.ts';
import { TransportRouter } from './transport/router.ts';
import { WebCache } from './transport/web-cache.ts';
import { WorkspaceFiles } from './transport/workspace-files.ts';
import { registerSystemModules, type SettingsPage } from './composition.ts';
import { createStorageLayout, type StorageLayout } from './platform/paths.ts';
import {
  createAppearanceStore,
  type AppearanceStore,
} from './platform/appearance.ts';
import { PluginStore } from './plugin/store.ts';
import { PluginService } from './plugin/service.ts';
import { PluginCatalogService } from './plugin/catalog.ts';
import { PageRouter, type PageTarget } from './page-router.ts';
import { ShellHost, type ShellHostOptions } from './domains/shell/native.ts';
import { Dispatcher } from './ipc/dispatcher.ts';
import { Origins } from './ipc/origins.ts';
import { IpcChannel } from './ipc/channel.ts';
import { CaptureChannel } from './ipc/capture.ts';
import { Protocols } from './protocols.ts';
import { PluginLifecycle } from './plugin/lifecycle.ts';
import { PluginManager } from './plugin/manager.ts';
import { DomainRegistry } from './registry/registry.ts';
import { createLog } from './log.ts';
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface NextAppOptions {
  dataRoot: string;
  workspaceRoot: string;
  /** 系统页产物目录（work://studio 的根）。 */
  rendererRoot: string;
  /** 开发模式的 vite 地址；有值时页面请求代理过去。 */
  devBase?: string;
  settingsPages?: SettingsPage[];
  /** 构建产物中的内置插件根目录；存在时播种到 plugins/installed。 */
  builtinPluginsRoot?: string;
  /** 打开 IPC 请求日志。 */
  ipcLog?: boolean;
  /** 覆盖默认 IPC 投递（测试或自定义通道）。 */
  sendUpdate?(viewId: string, update: DomainUpdate): void;
  /** Electron shell 宿主；不传则只保留结构投影。 */
  shell?: Omit<ShellHostOptions, 'origins'>;
}

function seedBuiltins(store: PluginStore, root: string | undefined): void {
  if (!root || !existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const sourceDir = join(root, name);
    if (!statSync(sourceDir).isDirectory()) continue;
    try {
      store.seedBuiltin({ id: name, sourceDir });
    } catch (error) {
      console.warn('[plugin] seed builtin failed', name, error);
    }
  }
}

export class NextApp {
  readonly registry = new DomainRegistry();
  readonly storage: StorageLayout;
  readonly appearance: AppearanceStore;
  readonly protocols: Protocols;
  readonly origins = new Origins();
  readonly transport: TransportRouter;
  readonly cache: WebCache;
  readonly plugins: PluginManager;
  readonly lifecycle: PluginLifecycle;
  readonly pluginStore: PluginStore;
  readonly pluginService: PluginService;
  readonly pages: PageRouter;
  readonly shellHost: ShellHost | null;
  readonly dispatcher: Dispatcher;
  readonly ipc: IpcChannel;
  readonly capture = new CaptureChannel();

  private started = false;

  constructor(options: NextAppOptions) {
    this.storage = createStorageLayout(options.dataRoot);
    this.appearance = createAppearanceStore(this.storage);
    this.protocols = new Protocols(options.rendererRoot, options.devBase);
    this.cache = new WebCache(this.storage.webCacheRoot);

    const files = new WorkspaceFiles(options.workspaceRoot);
    this.transport = new TransportRouter(files);
    // 工作区文件是内建传输适配器；内容读取经由 ref → 域 → adapter。
    this.transport.register('files', files, [{ prefixes: ['file://'] }]);

    this.pluginStore = new PluginStore(this.storage);
    seedBuiltins(this.pluginStore, options.builtinPluginsRoot);
    this.plugins = new PluginManager(
      this.registry,
      this.transport,
      this.pluginStore,
    );
    this.lifecycle = new PluginLifecycle(this.plugins, this.protocols);
    this.pluginService = new PluginService({
      store: this.pluginStore,
      lifecycle: this.lifecycle,
      catalog: new PluginCatalogService(this.storage),
    });
    this.shellHost = options.shell
      ? new ShellHost({ ...options.shell, origins: this.origins })
      : null;
    this.pages = new PageRouter(this.protocols, this.plugins, {
      openRef: (ref, workspaceId) => {
        void this.registry.dispatchCommand(
          { domain: 'workspace', resource: 'registry' },
          'openRef',
          { ref, workspaceId },
          {
            origin: { type: 'service', id: 'page-router' },
            changed: (target, type) => this.registry.changed(target, type),
            log: createLog('page-router'),
          },
        );
      },
    });

    registerSystemModules(this.registry, {
      storage: this.storage,
      workspaceRoot: options.workspaceRoot,
      protocols: this.protocols,
      transport: this.transport,
      cache: this.cache,
      plugins: this.plugins,
      lifecycle: this.lifecycle,
      pluginStore: this.pluginStore,
      pluginService: this.pluginService,
      appearance: this.appearance,
      ...(this.shellHost ? { shellHost: this.shellHost } : {}),
      openItem: (item, workspaceId) => this.openListItem(item, workspaceId),
      ...(options.settingsPages
        ? { settingsPages: options.settingsPages }
        : {}),
    });

    let ipc: IpcChannel | null = null;
    this.dispatcher = new Dispatcher(this.registry, this.origins, {
      ...(options.ipcLog === undefined ? {} : { log: options.ipcLog }),
      sendUpdate:
        options.sendUpdate ??
        ((viewId, update) => ipc?.sendUpdate(viewId, update)),
    });
    ipc = new IpcChannel(this.dispatcher, this.origins);
    this.ipc = ipc;
  }

  private async openListItem(
    item: ListItem,
    workspaceId: string,
  ): Promise<unknown> {
    const meta = item.meta ?? {};
    const ref = typeof meta['ref'] === 'string' ? meta['ref'] : '';
    const pageId = typeof meta['pageId'] === 'string' ? meta['pageId'] : '';
    const pluginId =
      typeof meta['pluginId'] === 'string' ? meta['pluginId'] : '';
    const url = typeof meta['url'] === 'string' ? meta['url'] : '';
    let target: PageTarget;
    if (ref) {
      target = { type: 'resource', workspaceId, ref };
    } else if (pageId) {
      target = { type: 'settings', workspaceId, pageId };
    } else if (pluginId) {
      target = {
        type: 'plugin',
        workspaceId,
        pluginId,
        surface: 'settings',
      };
    } else if (url) {
      target = { type: 'web', workspaceId, url, title: item.title };
    } else {
      throw new Error(`列表项没有打开目标：${item.key}`);
    }
    const page = this.pages.resolve(target);
    if (page.ref) {
      const opened = await this.registry.dispatchCommand(
        { domain: 'workspace', resource: 'registry' },
        'openRef',
        { ref: page.ref, workspaceId },
        {
          origin: { type: 'service', id: 'page-router' },
          changed: (ref, type) => this.registry.changed(ref, type),
          log: createLog('page-router'),
        },
      );
      if (!opened.ok) throw new Error(opened.error.message);
    }
    // 窗口与工作区 1:1：列表动作在列表所属窗口里开页面，不借用活动窗口。
    const result = await this.registry.dispatchCommand(
      { domain: 'shell', resource: `${workspaceId}/views` },
      'open',
      {
        id: page.contentPath,
        type: page.type === 'web' ? 'web' : 'page',
        title: page.title,
        url: page.url,
      },
      {
        origin: { type: 'service', id: 'list' },
        changed: (ref, type) => this.registry.changed(ref, type),
        log: createLog('list'),
      },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.ipc.attach();

    this.capture.attach((_senderId, message) => {
      const windowId = this.shellHost?.activeWindow();
      if (!windowId) return;
      const action =
        message.type === 'up'
          ? 'end'
          : message.type === 'cancel'
            ? 'cancel'
            : 'move';
      void this.registry.dispatchCommand(
        { domain: 'shell', resource: `${windowId}/layout` },
        action,
        message.type === 'move'
          ? {
              input: {
                pointerX: message.clientX,
                pointerY: message.clientY,
              },
            }
          : {},
        {
          origin: { type: 'service', id: 'capture' },
          changed: (ref, type) => this.registry.changed(ref, type),
          log: createLog('capture'),
        },
      );
    });
    await this.registry.start();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.ipc.detach();
    this.capture.detach();
    await this.registry.stop();
    this.shellHost?.dispose();
  }
}
