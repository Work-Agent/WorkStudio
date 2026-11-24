/**
 * workspace 模块：工作区宿主（生命周期 + 依赖）。
 *
 * 持有 WorkspaceScope 与列表投影；域只声明资源与命令，
 * 切换 / 释放由模块生命周期驱动。
 */

import type { DomainModule } from '../../registry/module.ts';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ListItem } from '../../../shared/lists.ts';
import { createLog } from '../../log.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { TransportRouter } from '../../transport/router.ts';
import {
  WorkspaceScope,
  createListState,
  defineListResource,
  defineSearchResource,
  defineWorkspaceRegistryResource,
  type ListState,
} from './domains.ts';
import { ListService } from './lists.ts';
import { registerSystemLists } from './list-builtins.ts';
import type { WorkspaceRepository } from './repo.ts';

export class WorkspaceModule implements DomainModule {
  readonly id = 'workspace';
  readonly dependencies = ['shell'] as const;

  private readonly scope: WorkspaceScope;
  private readonly list: ListState = createListState();
  readonly lists = new ListService();
  private registry: DomainRegistry | null = null;
  private offWorkspace: (() => void) | null = null;
  private readonly log = createLog('workspace');

  constructor(
    repo: WorkspaceRepository,
    private readonly transport: TransportRouter,
    private readonly openItem?: (item: ListItem) => Promise<unknown>,
  ) {
    this.scope = new WorkspaceScope(repo, transport);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    this.scope.bind(registry);
    registerSystemLists(this.lists.registry, {
      registry,
      transport: this.transport,
      workspacePath: () => this.scope.current?.path ?? '',
    });
    defineWorkspaceRegistryResource(registry, this.scope);
    defineSearchResource(registry, this.transport, () => ({
      workspacePath: this.scope.current?.path ?? '',
      workspaceId: this.scope.current?.id ?? '',
    }));
    defineListResource(
      registry,
      this.list,
      this.lists,
      () => ({
        workspacePath: this.scope.current?.path ?? '',
        workspaceId: this.scope.current?.id ?? '',
      }),
      this.openItem,
    );
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
        void this.refreshList();
        void this.openWindow(
          (update.data as { current: WorkspaceMeta | null }).current,
        );
      });
    }
    await this.refreshList();
    await this.openWindow(this.scope.current);
  }

  stop(): void {
    this.offWorkspace?.();
    this.offWorkspace = null;
    this.scope.dispose();
    this.list.snapshot = null;
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

  private async refreshList(): Promise<void> {
    this.list.snapshot = await this.lists.refresh({
      workspacePath: this.scope.current?.path ?? '',
      workspaceId: this.scope.current?.id ?? '',
    });
    this.registry?.define('workspace').resource('list').publish();
  }
}
