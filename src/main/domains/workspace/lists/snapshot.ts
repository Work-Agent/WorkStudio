import type {
  ListDefinition,
  ListGroup,
  ListItem,
  ListSnapshot,
} from '../../../../shared/lists.ts';
import type { ListContexts } from '../ura/contexts.ts';
import type { ListProviderGroup, ListRegistry } from './registry.ts';

interface ViewState {
  id: string;
  type: string;
  active: boolean;
  dirty?: boolean;
  url: string;
  document?: { id?: string };
}

export interface ListViewHost {
  list(): ViewState[];
}

export interface SnapshotDeps {
  registry: ListRegistry;
  contexts: ListContexts;
  viewHost: ListViewHost;
}

function latestOf(items: ListItem[]): number {
  return items.reduce((latest, item) => {
    const value = item.meta?.['updatedAt'];
    return typeof value === 'number' ? Math.max(latest, value) : latest;
  }, 0);
}

function countLabelOf(
  count: number,
  unit: string | undefined,
  override: string | undefined,
): string {
  if (override) return override;
  return count > 0 ? `${count} ${unit ?? '项'}` : '暂无';
}

function applyViewStates(groups: ListGroup[], views: ViewState[]): void {
  const byRef = new Map(
    views
      .map((view) => [view.document?.id ?? view.url, view] as const)
      .filter(([ref]) => Boolean(ref)),
  );
  const byUrl = new Map(
    views.filter((view) => view.url).map((view) => [view.url, view] as const),
  );
  for (const group of groups) {
    for (const item of group.items) {
      const view =
        item.itemType === 'document'
          ? byRef.get(String(item.meta?.['ref'] ?? ''))
          : item.itemType === 'web-page'
            ? byUrl.get(String(item.meta?.['url'] ?? ''))
            : undefined;
      if (!view) continue;
      item.meta = { ...item.meta, viewId: view.id };
      item.state = {
        ...item.state,
        open: true,
        active: view.active,
        dirty: view.dirty,
      };
    }
  }
}

function groupOf(
  definition: ListDefinition,
  group: ListProviderGroup,
): ListGroup {
  return {
    id: `${definition.id}:${group.id}`,
    definitionId: definition.id,
    section: definition.section ?? 'resources',
    label: group.label,
    ...(group.icon || definition.icon
      ? { icon: group.icon ?? definition.icon }
      : {}),
    ...(group.tone || definition.tone
      ? { tone: group.tone ?? definition.tone }
      : {}),
    ...(group.unit || definition.unit
      ? { unit: group.unit ?? definition.unit }
      : {}),
    countLabel: countLabelOf(
      group.items.length,
      group.unit ?? definition.unit,
      group.countLabel ?? definition.countLabel,
    ),
    updatedAt: group.updatedAt ?? latestOf(group.items),
    order: group.order,
    count: group.items.length,
    state: 'ready',
    fields: definition.fields,
    actions: definition.actions,
    ...(group.empty || definition.empty
      ? { empty: group.empty ?? definition.empty }
      : {}),
    items: group.items,
  };
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
    order: definition.order,
    count: 0,
    state: 'error',
    fields: definition.fields,
    actions: definition.actions,
    items: [],
    diagnostics: [error instanceof Error ? error.message : String(error)],
  };
}

/** 所有列表定义走同一个 provider → group 流程，不再为内置列表写特殊分支。 */
export async function buildListSnapshot(
  deps: SnapshotDeps,
  workspaceEpoch = 0,
): Promise<ListSnapshot> {
  const groups: ListGroup[] = [];
  for (const entry of deps.registry.providers()) {
    const definition = entry.definition;
    try {
      const ctx = deps.contexts.context(entry.owner);
      const provided = await entry.provider(ctx);
      for (const group of provided) groups.push(groupOf(definition, group));
    } catch (error) {
      groups.push(errorGroup(definition, error));
    }
  }
  applyViewStates(groups, deps.viewHost.list());
  groups.sort(
    (a, b) =>
      (deps.registry.get(a.definitionId)?.order ?? 0) -
      (deps.registry.get(b.definitionId)?.order ?? 0),
  );
  return { workspaceEpoch, groups };
}
