/**
 * 资源森林投影：provider → ResourceGroup → 每个工作区一份 ResourceForest。
 *
 * 文件列表是森林：每个 group 是一棵树；定义归 App/Workspace，
 * 数据由 provider 现取。插件贡献的树也注册到同一注册表。
 */

import type {
  ResourceContext,
  ResourceForest,
  ResourceGroup,
  ResourceGroupDefinition,
} from '../../../shared/resources.ts';

export type {
  ResourceContext,
  ResourceForest,
  ResourceGroup,
  ResourceGroupDefinition,
} from '../../../shared/resources.ts';

export type ResourceProvider = (
  ctx: ResourceContext,
) => Promise<ResourceGroup[]> | ResourceGroup[];

interface ResourceGroupEntry {
  definition: ResourceGroupDefinition;
  provider?: ResourceProvider;
  owner: string;
}

export class ResourceGroupRegistry {
  private readonly entries = new Map<string, ResourceGroupEntry>();
  private readonly listeners = new Set<(ids: string[]) => void>();

  /** 登记定义与取数实现；owner 用于热卸载时按插件清理。 */
  register(
    definition: ResourceGroupDefinition,
    provider: ResourceProvider | undefined,
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

  onChange(listener: (ids: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  touch(owner: string): void {
    const ids = this.idsOfOwner(owner);
    if (ids.length) this.notify(ids);
  }

  private notify(ids: string[]): void {
    for (const listener of this.listeners) listener(ids);
  }

  definitions(): ResourceGroupDefinition[] {
    return [...this.entries.values()]
      .map((entry) => entry.definition)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

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

  providers(only?: ReadonlySet<string>): ResourceGroupEntry[] {
    return [...this.entries.values()].filter(
      (entry) => entry.provider && (!only || only.has(entry.definition.id)),
    );
  }
}

export class ResourceForestService {
  readonly registry = new ResourceGroupRegistry();
  private readonly snapshots = new Map<string, ResourceForest>();
  private readonly revisions = new Map<string, number>();

  current(workspaceId: string): ResourceForest {
    return this.snapshots.get(workspaceId) ?? { revision: 0, groups: [] };
  }

  forget(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
    this.revisions.delete(workspaceId);
  }

  /** 全量或按组重算；未参与本次重算的组保留上一份结果。 */
  async refresh(
    context: ResourceContext,
    only?: ReadonlySet<string>,
  ): Promise<ResourceForest> {
    const revision = (this.revisions.get(context.workspaceId) ?? 0) + 1;
    this.revisions.set(context.workspaceId, revision);
    const previous = this.snapshots.get(context.workspaceId);
    const refreshed = new Map<string, ResourceGroup[]>();
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
    const order = new Map(
      this.registry
        .definitions()
        .map((definition) => [definition.id, definition.order ?? 0]),
    );
    const groups = [...kept, ...[...refreshed.values()].flat()].sort(
      (a, b) =>
        (order.get(a.definitionId) ?? 0) - (order.get(b.definitionId) ?? 0),
    );
    const snapshot: ResourceForest = { revision, groups };
    this.snapshots.set(context.workspaceId, snapshot);
    return snapshot;
  }
}

function errorGroup(
  definition: ResourceGroupDefinition,
  error: unknown,
): ResourceGroup {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `${definition.id}:error`,
    definitionId: definition.id,
    section: definition.section ?? 'resources',
    label: definition.label,
    ...(definition.icon ? { icon: definition.icon } : {}),
    ...(definition.tone ? { tone: definition.tone } : {}),
    ...(definition.unit ? { unit: definition.unit } : {}),
    count: 0,
    countLabel: definition.countLabel ?? `0 ${definition.unit ?? '项'}`,
    updatedAt: 0,
    order: definition.order ?? 0,
    state: 'error',
    fields: definition.fields,
    actions: definition.actions,
    roots: [],
    diagnostics: [message],
  };
}
