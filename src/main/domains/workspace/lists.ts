/**
 * 系统列表投影：provider → ListGroup → 每个工作区一份 ListSnapshot。
 *
 * 列表定义归 App/Workspace，数据由 provider 现取；系统与插件列表共用
 * 同一注册表，插件定义以插件 id 为 owner，撤销时按 owner 清理。
 */

import type {
  ListDefinition,
  ListGroup,
  ListSnapshot,
} from '../../../shared/lists.ts';

export type {
  ListDefinition,
  ListGroup,
  ListSnapshot,
} from '../../../shared/lists.ts';

export interface ListProviderContext {
  workspacePath: string;
  workspaceId: string;
}

export type ListProvider = (
  ctx: ListProviderContext,
) => Promise<ListGroup[]> | ListGroup[];

interface ListEntry {
  definition: ListDefinition;
  provider?: ListProvider;
  owner: string;
}

export class ListRegistry {
  private readonly entries = new Map<string, ListEntry>();
  private readonly listeners = new Set<(ids: string[]) => void>();

  /**
   * 登记定义与取数实现。注册本身不代表数据可算：系统列表在模块启动时
   * 全量刷新，插件列表在 runtime 就绪后由 `touch` 触发。
   */
  register(
    definition: ListDefinition,
    provider: ListProvider | undefined,
    owner = 'system',
  ): void {
    this.entries.set(definition.id, { definition, provider, owner });
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  idsOfOwner(owner: string): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.owner === owner) ids.push(id);
    }
    return ids;
  }

  revokeOwner(owner: string): void {
    const removed: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.owner !== owner) continue;
      this.entries.delete(id);
      removed.push(id);
    }
    if (removed.length) this.notify(removed);
  }

  /** 订阅定义集合变化：返回本次受影响的列表 id。 */
  onChange(listener: (ids: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 归属方完成一轮注册后主动触发重算。 */
  touch(owner: string): void {
    const ids = this.idsOfOwner(owner);
    if (ids.length) this.notify(ids);
  }

  private notify(ids: string[]): void {
    for (const listener of this.listeners) listener(ids);
  }

  definitions(): ListDefinition[] {
    return [...this.entries.values()]
      .map((entry) => entry.definition)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** 来源资源命中：哪些组需要随它重算；事件级依赖同时比对事件名。 */
  definitionsOf(domain: string, resource: string, event?: string): string[] {
    const matched: string[] = [];
    for (const [id, entry] of this.entries) {
      const deps = entry.definition.deps ?? [];
      const hit = deps.some(
        (dep) =>
          dep.domain === domain &&
          (dep.resource === resource ||
            resource.endsWith(`/${dep.resource}`)) &&
          (dep.event === undefined || dep.event === event),
      );
      if (hit) matched.push(id);
    }
    return matched;
  }

  providers(only?: ReadonlySet<string>): ListEntry[] {
    return [...this.entries.values()].filter(
      (entry) => entry.provider && (!only || only.has(entry.definition.id)),
    );
  }
}

export class ListService {
  readonly registry = new ListRegistry();
  private readonly snapshots = new Map<string, ListSnapshot>();
  private readonly epochs = new Map<string, number>();

  current(workspaceId: string): ListSnapshot {
    return this.snapshots.get(workspaceId) ?? { workspaceEpoch: 0, groups: [] };
  }

  forget(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
    this.epochs.delete(workspaceId);
  }

  /** 全量或按组重算；未参与本次重算的组保留上一份结果。 */
  async refresh(
    context: ListProviderContext,
    only?: ReadonlySet<string>,
  ): Promise<ListSnapshot> {
    const epoch = (this.epochs.get(context.workspaceId) ?? 0) + 1;
    this.epochs.set(context.workspaceId, epoch);
    const previous = this.snapshots.get(context.workspaceId);
    const refreshed = new Map<string, ListGroup[]>();
    for (const entry of this.registry.providers(only)) {
      try {
        refreshed.set(
          entry.definition.id,
          (await entry.provider?.(context)) ?? [],
        );
      } catch (error) {
        refreshed.set(entry.definition.id, [
          errorGroup(entry.definition, error),
        ]);
      }
    }
    const kept = (previous?.groups ?? []).filter(
      (group) =>
        !refreshed.has(group.definitionId) &&
        this.registry.has(group.definitionId),
    );
    const groups = [...kept, ...[...refreshed.values()].flat()].sort(
      (a, b) =>
        (this.registry.definitions().find((item) => item.id === a.definitionId)
          ?.order ?? 0) -
        (this.registry.definitions().find((item) => item.id === b.definitionId)
          ?.order ?? 0),
    );
    const snapshot: ListSnapshot = { workspaceEpoch: epoch, groups };
    this.snapshots.set(context.workspaceId, snapshot);
    return snapshot;
  }
}

function errorGroup(definition: ListDefinition, error: unknown): ListGroup {
  return {
    id: `${definition.id}:error`,
    definitionId: definition.id,
    section: definition.section ?? 'resources',
    label: definition.label,
    ...(definition.icon ? { icon: definition.icon } : {}),
    countLabel: '加载失败',
    updatedAt: 0,
    count: 0,
    order: definition.order,
    state: 'error',
    fields: definition.fields,
    actions: definition.actions,
    items: [],
    diagnostics: [error instanceof Error ? error.message : String(error)],
  };
}
