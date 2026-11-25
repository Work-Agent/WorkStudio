/**
 * workspace 模块：工作区宿主（生命周期 + 依赖）。
 *
 * 持有 WorkspaceScope 与按工作区划分的列表资源（`workspace/<wsId>/list`）；
 * 域只声明资源与命令，切换 / 释放由模块生命周期驱动。
 */

import type { DomainModule } from '../../registry/module.ts';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ListItem } from '../../../shared/lists.ts';
import { createLog } from '../../log.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { TransportRouter } from '../../transport/router.ts';
import {
  WorkspaceScope,
  defineWorkspaceListResource,
  defineWorkspaceRegistryResource,
  defineWorkspaceSearchResource,
  listResourceName,
  searchResourceName,
} from './domains.ts';
import { ListService } from './lists.ts';
import { registerSystemLists } from './list-builtins.ts';
import type { WorkspaceRepository } from './repo.ts';

export class WorkspaceModule implements DomainModule {
  readonly id = 'workspace';
  readonly dependencies = ['shell'] as const;

  private readonly scope: WorkspaceScope;
  private readonly listWorkspaces = new Set<string>();
  private registry: DomainRegistry | null = null;
  private offWorkspace: (() => void) | null = null;
  private offLists: (() => void) | null = null;
  private offListDefs: (() => void) | null = null;
  private listTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLists = new Set<string>();
  private readonly log = createLog('workspace');

  constructor(
    repo: WorkspaceRepository,
    private readonly transport: TransportRouter,
    readonly lists: ListService,
    private readonly openItem?: (
      item: ListItem,
      workspaceId: string,
    ) => Promise<unknown>,
  ) {
    this.scope = new WorkspaceScope(repo, transport);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.scope.bind(registry);
    registerSystemLists(this.lists.registry, {
      registry,
      transport: this.transport,
    });
    defineWorkspaceRegistryResource(registry, this.scope);
  }

  async start(): Promise<void> {
    this.scope.restore();
    const registry = this.registry;
    if (registry) {
      this.offWorkspace = registry.onUpdate((update) => {
        if (
          update.domain !== 'workspace' ||
          update.resource !== 'registry' ||
          update.type !== 'snapshot'
        ) {
          return;
        }
        void this.syncWorkspaceResources();
        void this.openWindow(
          (update.data as { current: WorkspaceMeta | null }).current,
        );
      });
      // 列表来源变化：只重算声明了该来源的组（同轮合并成一次）。
      this.offLists = registry.onUpdate((update) => {
        const ids = this.lists.registry.definitionsOf(
          update.domain,
          update.resource,
          update.type === 'event' ? update.event : undefined,
        );
        if (ids.length > 0) this.scheduleListRefresh(ids);
      });
      // 插件列表注册 / 撤销：重算对应定义。
      this.offListDefs = this.lists.registry.onChange((ids) =>
        this.scheduleListRefresh(ids),
      );
    }
    await this.syncWorkspaceResources();
    await this.openWindow(this.scope.current);
  }

  stop(): void {
    this.offWorkspace?.();
    this.offWorkspace = null;
    this.offLists?.();
    this.offLists = null;
    this.offListDefs?.();
    this.offListDefs = null;
    if (this.listTimer) clearTimeout(this.listTimer);
    this.listTimer = null;
    this.pendingLists.clear();
    this.scope.dispose();
    for (const workspaceId of this.listWorkspaces)
      this.lists.forget(workspaceId);
    this.listWorkspaces.clear();
    this.registry = null;
  }

  private async openWindow(meta: WorkspaceMeta | null): Promise<void> {
    const registry = this.registry;
    if (!registry || !meta) return;
    const result = await registry.dispatchCommand(
      { domain: 'shell', resource: 'windows' },
      'open',
      { workspaceId: meta.id },
      {
        origin: { type: 'service', id: 'workspace' },
        changed: (ref, type) => registry.changed(ref, type),
        log: this.log,
      },
    );
    if (!result.ok) {
      this.log.warn(`打开工作区窗口失败：${result.error.message}`);
    }
  }

  /** 注册表变化：补齐 / 回收每个工作区的列表与搜索资源，再重算列表。 */
  private async syncWorkspaceResources(): Promise<void> {
    const registry = this.registry;
    if (!registry) return;
    const workspaces = this.scope.snapshot().workspaces;
    const known = new Set(workspaces.map((meta) => meta.id));
    for (const workspaceId of Array.from(this.listWorkspaces)) {
      if (known.has(workspaceId)) continue;
      this.listWorkspaces.delete(workspaceId);
      this.lists.forget(workspaceId);
      this.scope.releaseRefs(workspaceId);
      registry.define('workspace').remove(listResourceName(workspaceId));
      registry.define('workspace').remove(searchResourceName(workspaceId));
    }
    await Promise.all(
      workspaces.map(async (meta) => {
        this.listWorkspaces.add(meta.id);
        this.ensureList(meta.id);
        this.ensureSearch(meta.id);
        await this.refreshList(meta.id, meta.path);
      }),
    );
  }

  private ensureSearch(workspaceId: string): void {
    const registry = this.registry;
    if (!registry) return;
    if (
      registry.define('workspace').resourceOf(searchResourceName(workspaceId))
    )
      return;
    defineWorkspaceSearchResource(registry, workspaceId, this.transport, () => {
      const meta = this.scope
        .snapshot()
        .workspaces.find((item) => item.id === workspaceId);
      return meta?.path ?? '';
    });
  }

  private ensureList(workspaceId: string): void {
    const registry = this.registry;
    if (!registry) return;
    const resource = registry
      .define('workspace')
      .resourceOf(listResourceName(workspaceId));
    if (resource) return;
    defineWorkspaceListResource(
      registry,
      workspaceId,
      this.lists,
      () => {
        const meta = this.scope
          .snapshot()
          .workspaces.find((item) => item.id === workspaceId);
        return { workspaceId, workspacePath: meta?.path ?? '' };
      },
      this.openItem,
    );
  }

  private async refreshList(workspaceId: string, path: string): Promise<void> {
    await this.lists.refresh({ workspaceId, workspacePath: path });
    this.registry
      ?.define('workspace')
      .resource(listResourceName(workspaceId))
      .publish();
  }

  /** 同一轮内的来源变更合并成一次重算。 */
  private scheduleListRefresh(ids: string[]): void {
    for (const id of ids) this.pendingLists.add(id);
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => {
      const only = new Set(this.pendingLists);
      this.pendingLists.clear();
      this.listTimer = null;
      void this.refreshAffected(only);
    }, 16);
  }

  private async refreshAffected(only: ReadonlySet<string>): Promise<void> {
    const paths = new Map(
      this.scope.snapshot().workspaces.map((meta) => [meta.id, meta.path]),
    );
    await Promise.all(
      Array.from(this.listWorkspaces).map(async (workspaceId) => {
        await this.lists.refresh(
          { workspaceId, workspacePath: paths.get(workspaceId) ?? '' },
          only,
        );
        this.registry
          ?.define('workspace')
          .resource(listResourceName(workspaceId))
          .publish();
      }),
    );
  }
}
