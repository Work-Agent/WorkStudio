/**
 * workspace module：工作区、资源、列表与插件的生命周期组合。
 *
 * Domain 仍按能力拆分：workspaces / resources / lists / plugins；
 * 工作区只是资源路径中的 scope 条件（`ws:<wsId>`），不是一个 domain。
 * 这些能力共享工作区生命周期，因此由同一个 DomainModule 管理 start / stop。
 */

import { join } from 'node:path';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ListItem, ListSnapshot } from '../../../shared/lists.ts';
import type { DomainModule, DomainRegistry } from '../../runtime/domains.ts';
import type { StoragePaths } from '../../runtime/storage/storage-paths.ts';
import type { Views } from '../shell/views.ts';
import type { AgentDomain } from '../agent/module.ts';
import type { ResourcesDeps, ResourcesRuntime } from './resources.ts';
import { registerBrowserFeatures } from './browser/features.ts';
import { createListsRuntime, type ListsRuntime } from './lists/index.ts';
import { defineListsDomain, type ListsDeps } from './lists.ts';
import { PluginCatalogService } from './plugins/catalog.ts';
import { PluginService } from './plugins/plugin-source.ts';
import { PluginsService } from './plugins/plugins-service.ts';
import { definePluginsDomain, type PluginSurface } from './plugins.ts';
import { WorkspacesRepo } from './repo.ts';
import { ResourcesService } from './resources/service.ts';
import { defineResourcesDomain } from './resources.ts';
import { PageSessions } from './ura/page-sessions.ts';
import { createUraRuntime, type UraRuntime } from './ura/index.ts';
import { defineWorkspacesDomain } from './workspaces.ts';
import { settingsPages } from '../settings/registry.ts';

export interface WorkspaceModuleOptions {
  storage: StoragePaths;
  appPath(): string;
  views: Views;
  agent(): AgentDomain | null;
  openWindow(wsId: string): void;
  closeWindow(wsId: string): void;
  openResource(ref: string): Promise<{ id: string }>;
  openWeb(url: string, title?: string): Promise<{ id: string }>;
  openPlugin(pluginId: string, surface: PluginSurface): Promise<{ id: string }>;
  openPageView(ref: string): Promise<{
    type: 'page' | 'browser';
    pageId?: string;
    viewId?: string;
    url?: string;
  }>;
  savePageCopy(
    pageId: string,
    content: string | Uint8Array,
  ): Promise<{ saved: boolean; ref?: string }>;
  openItem(item: ListItem): Promise<unknown>;
  onChanged(): void;
  onSettingsChanged(): void;
}

export class WorkspaceModule implements DomainModule {
  readonly dependencies = ['shell'] as const;
  readonly id = 'workspace';
  readonly repo: WorkspacesRepo;

  private readonly options: WorkspaceModuleOptions;
  private registry: DomainRegistry | null = null;
  private currentMeta: WorkspaceMeta | null = null;
  private uraRuntime: UraRuntime | null = null;
  private service: ResourcesService | null = null;
  private pluginService: PluginService | null = null;
  private pluginCatalog: PluginCatalogService | null = null;
  private plugins: PluginsService | null = null;
  private workspaceId: string | null = null;
  private init: Promise<ResourcesRuntime> | null = null;
  private listRuntime: ListsRuntime | null = null;
  private listSnapshot: ListSnapshot | null = null;
  private refreshPromise: Promise<void> | null = null;
  private readonly boundWorkspaceIds = new Set<string>();

  constructor(options: WorkspaceModuleOptions) {
    this.options = options;
    this.repo = new WorkspacesRepo(options.storage);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;

    defineWorkspacesDomain(registry, this.repo, {
      current: () => this.currentMeta,
      open: (id) => this.options.openWindow(id),
      close: (id) => this.options.closeWindow(id),
    });
    defineResourcesDomain(registry, this.resourcesDeps());
    defineListsDomain(registry, this.listsDeps());
    definePluginsDomain(registry, {
      runtime: () => this.runtime(),
      ensure: () => this.ensure(),
      open: (pluginId, surface) => this.options.openPlugin(pluginId, surface),
      installed: () => this.plugins?.installed() ?? [],
      catalog: () => this.pluginCatalog?.currentUrl() ?? '',
      catalogRefresh: async () => {
        await this.ensure();
        return this.pluginCatalog?.load() ?? { entries: [] };
      },
      task: () => this.plugins?.task ?? null,
      cancel: () => this.plugins?.cancelInstall() ?? null,
      retry: async () => {
        await this.plugins?.retryInstall();
        this.pluginsChanged();
      },
      install: async (source) => {
        await this.ensure();
        await this.plugins!.install(source);
        this.pluginsChanged();
      },
      remove: async (source) => {
        await this.ensure();
        await this.plugins!.remove(source);
        this.pluginsChanged();
      },
      reload: async (source) => {
        await this.ensure();
        await this.plugins!.install(source, true);
        this.pluginsChanged();
      },
    });
  }

  get current(): WorkspaceMeta | null {
    return this.currentMeta;
  }

  get listSnapshotState(): ListSnapshot | null {
    return this.listSnapshot;
  }

  restore(preferredId?: string): WorkspaceMeta | null {
    if (preferredId) return this.find(preferredId);
    try {
      return this.repo.restore();
    } catch {
      return null;
    }
  }

  find(id: string): WorkspaceMeta | null {
    return this.repo.list().find((item) => item.id === id) ?? null;
  }

  setCurrent(meta: WorkspaceMeta | null): void {
    this.currentMeta = meta;
    this.repo.writeCurrent(meta?.id ?? null);
    this.bindWorkspaceResources(meta);
    this.publish();
  }

  publish(): void {
    if (!this.registry) return;
    const domain = this.registry.define('workspaces');
    domain.resource('list').publish();
    domain.resource('current').publish();
  }

  runtime(): ResourcesRuntime | null {
    return this.service && this.uraRuntime
      ? { service: this.service, ura: this.uraRuntime }
      : null;
  }

  resources(): ResourcesService | null {
    return this.service;
  }

  ura(): UraRuntime | null {
    return this.uraRuntime;
  }

  pluginsService(): PluginsService | null {
    return this.plugins;
  }

  reset(): void {
    this.service?.reset();
    this.workspaceId = null;
    this.init = null;
    this.listRuntime = null;
    this.listSnapshot = null;
    for (const id of this.boundWorkspaceIds) {
      const scope = `ws:${id}`;
      this.registry?.define('resources').remove(scope);
      this.registry?.define('lists').remove(scope);
    }
    this.boundWorkspaceIds.clear();
  }

  async ensure(): Promise<ResourcesRuntime> {
    const workspace = this.currentMeta;
    if (!workspace) throw new Error('no workspace');
    if (this.init && this.workspaceId === workspace.id) return this.init;

    const init = (async (): Promise<ResourcesRuntime> => {
      if (!this.pluginService) {
        this.pluginService = new PluginService({
          root: this.options.storage.pluginsRoot,
          cwd: () => this.currentMeta?.path ?? '',
        });
        await this.pluginService.start();
        this.pluginCatalog = new PluginCatalogService({
          cacheFile: join(this.options.storage.pluginsRoot, 'catalog.md'),
          urlFile: join(this.options.storage.pluginsRoot, 'catalog-url.txt'),
        });
        await this.pluginCatalog.start();
      }

      if (!this.uraRuntime) {
        this.uraRuntime = await createUraRuntime({
          dataRoot: this.options.storage.pluginDataRoot,
          bindingFile: this.options.storage.uraBindingsFile,
          workspace: () => this.currentMeta?.path ?? '',
          registerFeatures: registerBrowserFeatures,
          pluginRoots: [
            ...(this.pluginService?.roots() ?? []),
            join(this.options.appPath(), 'src', 'plugins'),
            join(this.options.appPath(), 'out', 'plugins'),
            this.options.storage.pluginsRoot,
          ],
        });
      }

      if (!this.plugins && this.pluginService && this.pluginCatalog) {
        this.plugins = new PluginsService({
          service: this.pluginService,
          catalog: this.pluginCatalog,
          host: this.uraRuntime.host,
        });
        this.plugins.onChange(() => {
          this.pluginsChanged();
          this.options.onSettingsChanged();
        });
        this.plugins.onTask(() => this.publishPlugins());
      }

      if (!this.service) {
        this.service = new ResourcesService({
          ura: this.uraRuntime.ura,
          pages: new PageSessions(this.uraRuntime.ura),
        });
        this.service.onPagesChange(() => this.resourcesChanged());
      } else {
        this.service.reset();
        this.uraRuntime.map.restart();
      }

      this.workspaceId = workspace.id;
      this.resourcesChanged();
      this.options.onSettingsChanged();
      return { service: this.service, ura: this.uraRuntime };
    })();

    this.init = init.catch((error: unknown) => {
      this.init = null;
      throw error;
    });
    return this.init;
  }

  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.ensure()
      .then((runtime) => this.ensureListRuntime(runtime))
      .then((service) => service.snapshot())
      .then((snapshot) => {
        this.listSnapshot = snapshot;
        this.publishLists();
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  stop(): void {
    this.dispose();
    this.listRuntime = null;
    this.listSnapshot = null;
    this.refreshPromise = null;
    this.currentMeta = null;
  }

  private resourcesChanged(): void {
    this.publishResources();
    this.options.onChanged();
  }

  private pluginsChanged(): void {
    this.publishPlugins();
    this.options.onChanged();
  }

  publishResources(): void {
    const domain = this.registry?.define('resources');
    if (!domain) return;
    domain.resource('current').publish();
    if (this.currentMeta)
      domain.resource(`ws:${this.currentMeta.id}`).publish();
  }

  private publishLists(): void {
    const domain = this.registry?.define('lists');
    if (!domain) return;
    domain.resource('current').publish();
    if (this.currentMeta)
      domain.resource(`ws:${this.currentMeta.id}`).publish();
  }

  private publishPlugins(): void {
    const domain = this.registry?.define('plugins');
    if (!domain) return;
    for (const name of ['list', 'installed', 'catalog', 'task']) {
      domain.resource(name).publish();
    }
  }

  private resourcesDeps(): ResourcesDeps {
    return {
      current: () => this.currentMeta,
      runtime: () => this.runtime(),
      ensure: () => this.ensure(),
      changed: () => this.resourcesChanged(),
      openView: (ref) => this.options.openResource(ref),
      openWeb: (url, title) => this.options.openWeb(url, title),
      openPageView: (ref) => this.options.openPageView(ref),
      saveCopy: (pageId, content) => this.options.savePageCopy(pageId, content),
      refresh: async () => {
        await this.ensure();
        this.resourcesChanged();
      },
    };
  }

  private listsDeps(): ListsDeps {
    return {
      snapshot: () => this.listSnapshot,
      refresh: () => this.refresh(),
      openItem: (item) => this.options.openItem(item),
    };
  }

  private bindWorkspaceResources(meta: WorkspaceMeta | null): void {
    if (!meta || this.boundWorkspaceIds.has(meta.id) || !this.registry) return;
    const scope = `ws:${meta.id}`;
    defineResourcesDomain(this.registry, this.resourcesDeps(), scope, meta.id);
    defineListsDomain(this.registry, this.listsDeps(), scope);
    this.boundWorkspaceIds.add(meta.id);
  }

  private dispose(): void {
    this.reset();
    this.service = null;
    this.uraRuntime = null;
    this.plugins = null;
    this.pluginCatalog = null;
    this.pluginService = null;
  }

  private ensureListRuntime(runtime: ResourcesRuntime): ListsRuntime {
    if (this.listRuntime) return this.listRuntime;
    this.listRuntime = createListsRuntime({
      contexts: runtime.ura.contexts,
      plugins: () => runtime.ura.host,
      settingsPages: () => settingsPages(),
      sessions: () => ({
        activePath:
          this.options.agent()?.sessions()?.current?.sessionFile ?? null,
        list: this.options.agent()?.sessions()?.list ?? [],
      }),
      viewHost: {
        list: () =>
          this.options.views.list().map((view) => ({
            id: view.id,
            type: view.type,
            title: view.title,
            url: view.url,
            active: view.active,
            dirty: view.dirty,
            document: (() => {
              const sessionId = this.options.views.get(view.id)?.sessionId;
              return sessionId
                ? {
                    id: this.resources()?.page(sessionId)?.ref,
                  }
                : undefined;
            })(),
          })),
      },
    });
    return this.listRuntime;
  }
}
