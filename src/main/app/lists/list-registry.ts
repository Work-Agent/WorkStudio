/**
 * 列表定义注册表（Phase 4）。
 *
 * 定义归 App；内置列表与插件列表使用同一注册面。
 */

import type { ListDefinition, ListItem } from '../../../shared/lists';
import type { CollectionContext } from '../../../shared/ura';

export interface ListProviderGroup {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  items: ListItem[];
  empty?: { icon?: string; text: string };
}

export type ListProvider = (
  ctx: CollectionContext,
) => Promise<ListProviderGroup[]> | ListProviderGroup[];

interface ListEntry {
  definition: ListDefinition;
  provider?: ListProvider;
  owner: string;
}

export class ListRegistry {
  private readonly entries = new Map<string, ListEntry>();

  register(
    definition: ListDefinition,
    provider?: ListProvider,
    owner = 'builtin',
  ): void {
    this.entries.set(definition.id, { definition, provider, owner });
  }

  get(id: string): ListDefinition | undefined {
    return this.entries.get(id)?.definition;
  }

  all(): ListDefinition[] {
    return [...this.entries.values()]
      .map((entry) => entry.definition)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  providers(): Array<{
    definition: ListDefinition;
    provider: ListProvider;
    owner: string;
  }> {
    const result: Array<{
      definition: ListDefinition;
      provider: ListProvider;
      owner: string;
    }> = [];
    for (const entry of this.entries.values()) {
      if (entry.provider)
        result.push({
          definition: entry.definition,
          provider: entry.provider,
          owner: entry.owner,
        });
    }
    return result;
  }
}

export const listRegistry = new ListRegistry();
