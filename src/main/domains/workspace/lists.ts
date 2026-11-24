/**
 * 系统列表投影：provider → ListGroup → 一个 ListSnapshot。
 *
 * 列表定义归 App/Workspace，数据由 provider 现取；插件列表暂不开放，
 * 这里只承载 docs/temp/sessions/plugins/settings 五类系统 provider。
 */

import type {
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

  register(
    definition: ListDefinition,
    provider: ListProvider | undefined,
    owner = 'system',
  ): void {
    this.entries.set(definition.id, { definition, provider, owner });
  }

  revokeOwner(owner: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.owner === owner) this.entries.delete(id);
    }
  }

  definitions(): ListDefinition[] {
    return [...this.entries.values()]
      .map((entry) => entry.definition)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  providers(): ListEntry[] {
    return [...this.entries.values()].filter((entry) => entry.provider);
  }
}

export class ListService {
  readonly registry = new ListRegistry();
  private snapshot: ListSnapshot = { workspaceEpoch: 0, groups: [] };
  private epoch = 0;

  current(): ListSnapshot {
    return this.snapshot;
  }

  async refresh(context: ListProviderContext): Promise<ListSnapshot> {
    this.epoch += 1;
    const groups: ListGroup[] = [];
    for (const entry of this.registry.providers()) {
      try {
        const provided = await entry.provider?.(context);
        if (provided) groups.push(...provided);
      } catch (error) {
        groups.push(errorGroup(entry.definition, error));
      }
    }
    groups.sort(
      (a, b) =>
        (this.registry.definitions().find((item) => item.id === a.definitionId)
          ?.order ?? 0) -
        (this.registry.definitions().find((item) => item.id === b.definitionId)
          ?.order ?? 0),
    );
    this.snapshot = { workspaceEpoch: this.epoch, groups };
    return this.snapshot;
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
