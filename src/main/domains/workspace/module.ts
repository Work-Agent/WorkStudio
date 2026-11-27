/**
 * workspace 模块：工作区宿主（生命周期 + 依赖）。
 *
 * 持有 WorkspaceScope 与按工作区划分的资源森林（`workspace/<wsId>/resources`）；
 * 域只声明资源与命令，切换 / 释放由模块生命周期驱动。
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DomainModule } from '../../registry/module.ts';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ResourceNode } from '../../../shared/resources.ts';
import { createLog } from '../../log.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { TransportRouter } from '../../transport/router.ts';
import {
  WorkspaceScope,
  defineWorkspaceResourcesResource,
  defineWorkspaceRegistryResource,
  defineWorkspaceSearchResource,
  resourcesResourceName,
  searchResourceName,
} from './domains.ts';
import { ResourceForestService } from './resources.ts';
import { registerSystemResources } from './resource-builtins.ts';
import type { WorkspaceRepository } from './repo.ts';

export class WorkspaceModule implements DomainModule {
  readonly id = 'workspace';
  readonly dependencies = ['shell'] as const;

  private readonly scope: WorkspaceScope;
  private readonly resourceWorkspaces = new Set<string>();
  private registry: DomainRegistry | null = null;
  private offWorkspace: (() => void) | null = null;
  private offResources: (() => void) | null = null;
  private offResourceDefs: (() => void) | null = null;
  private resourceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResources = new Set<string>();
  private readonly log = createLog('workspace');

  constructor(
    repo: WorkspaceRepository,
    private readonly transport: TransportRouter,
    readonly resources: ResourceForestService,
    private readonly openNode?: (
      node: ResourceNode,
      workspaceId: string,
    ) => Promise<unknown>,
    /** 首次启动没有工作区时询问目录；返回 null 表示用户取消。 */
    private readonly pickWorkspace?: () => Promise<string | null>,
  ) {
    this.scope = new WorkspaceScope(repo, transport);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.scope.bind(registry);
    registerSystemResources(this.resources.registry, {
      registry,
      transport: this.transport,
    });
    defineWorkspaceRegistryResource(registry, this.scope);
  }

  async start(): Promise<void> {
    this.scope.restore();
    if (!this.scope.current) await this.openFirstWorkspace();
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
      // 来源变化：只重算声明了该来源的组（同轮合并成一次）。
      this.offResources = registry.onUpdate((update) => {
        const ids = this.resources.registry.definitionsOf(
          update.domain,
          update.resource,
          update.type === 'event' ? update.event : undefined,
        );
        if (ids.length > 0) this.scheduleResourceRefresh(ids);
      });
      // 插件资源组注册 / 撤销：重算对应定义。
      this.offResourceDefs = this.resources.registry.onChange((ids) =>
        this.scheduleResourceRefresh(ids),
      );
    }
    await this.syncWorkspaceResources();
    await this.openWindow(this.scope.current);
  }

  stop(): void {
    this.offWorkspace?.();
    this.offWorkspace = null;
    this.offResources?.();
    this.offResources = null;
    this.offResourceDefs?.();
    this.offResourceDefs = null;
    if (this.resourceTimer) clearTimeout(this.resourceTimer);
    this.resourceTimer = null;
    this.pendingResources.clear();
    this.scope.dispose();
    for (const workspaceId of this.resourceWorkspaces)
      this.resources.forget(workspaceId);
    this.resourceWorkspaces.clear();
    this.registry = null;
  }

  /**
   * 首次启动：先让人选目录（原生面板同时给出目录访问授权），
   * 取消就落到 `~/WorkStudio`。绝不能拿安装包的 cwd（`/`）当工作区。
   */
  private async openFirstWorkspace(): Promise<void> {
    let picked: string | null = null;
    try {
      picked = (await this.pickWorkspace?.()) ?? null;
    } catch (error) {
      this.log.warn(`选择工作区失败：${String(error)}`);
    }
    const fallback = join(homedir(), 'WorkStudio');
    try {
      mkdirSync(fallback, { recursive: true });
      this.scope.open(picked ?? fallback);
    } catch (error) {
      this.log.warn(`打开工作区失败：${String(error)}`);
    }
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

  /** 注册表变化：补齐 / 回收每个工作区的资源森林与搜索资源。 */
  private async syncWorkspaceResources(): Promise<void> {
    const registry = this.registry;
    if (!registry) return;
    const workspaces = this.scope.snapshot().workspaces;
    const known = new Set(workspaces.map((meta) => meta.id));
    for (const workspaceId of Array.from(this.resourceWorkspaces)) {
      if (known.has(workspaceId)) continue;
      this.resourceWorkspaces.delete(workspaceId);
      this.resources.forget(workspaceId);
      this.scope.releaseRefs(workspaceId);
      registry.define('workspace').remove(resourcesResourceName(workspaceId));
      registry.define('workspace').remove(searchResourceName(workspaceId));
    }
    await Promise.all(
      workspaces.map(async (meta) => {
        this.resourceWorkspaces.add(meta.id);
        this.ensureResources(meta.id);
        this.ensureSearch(meta.id);
        await this.refreshResources(meta.id, meta.path);
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

  private ensureResources(workspaceId: string): void {
    const registry = this.registry;
    if (!registry) return;
    const resource = registry
      .define('workspace')
      .resourceOf(resourcesResourceName(workspaceId));
    if (resource) return;
    defineWorkspaceResourcesResource(
      registry,
      workspaceId,
      this.resources,
      () => {
        const meta = this.scope
          .snapshot()
          .workspaces.find((item) => item.id === workspaceId);
        return { workspaceId, workspacePath: meta?.path ?? '' };
      },
      this.openNode,
    );
  }

  private async refreshResources(
    workspaceId: string,
    path: string,
  ): Promise<void> {
    await this.resources.refresh({ workspaceId, workspacePath: path });
    this.registry
      ?.define('workspace')
      .resource(resourcesResourceName(workspaceId))
      .publish();
  }

  /** 同一轮内的来源变更合并成一次重算。 */
  private scheduleResourceRefresh(ids: string[]): void {
    for (const id of ids) this.pendingResources.add(id);
    if (this.resourceTimer) return;
    this.resourceTimer = setTimeout(() => {
      const only = new Set(this.pendingResources);
      this.pendingResources.clear();
      this.resourceTimer = null;
      void this.refreshAffectedResources(only);
    }, 16);
  }

  private async refreshAffectedResources(
    only: ReadonlySet<string>,
  ): Promise<void> {
    const paths = new Map(
      this.scope.snapshot().workspaces.map((meta) => [meta.id, meta.path]),
    );
    await Promise.all(
      Array.from(this.resourceWorkspaces).map(async (workspaceId) => {
        await this.resources.refresh(
          { workspaceId, workspacePath: paths.get(workspaceId) ?? '' },
          only,
        );
        this.registry
          ?.define('workspace')
          .resource(resourcesResourceName(workspaceId))
          .publish();
      }),
    );
  }
}
