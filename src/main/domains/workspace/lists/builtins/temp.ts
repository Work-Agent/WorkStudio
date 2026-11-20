import type { ListDefinition, ListItem } from '../../../../../shared/lists.ts';
import type { ListProvider } from '../registry.ts';
import { OPEN_ACTION } from './common.ts';

export const tempDefinition: ListDefinition = {
  id: 'temp',
  label: '临时网页',
  icon: 'hourglass',
  tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
  unit: '个标签',
  order: 30,
  sourceScope: 'workspace',
  itemType: 'link',
  fields: [{ key: 'title', type: 'text' }],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export interface TempView {
  id: string;
  type: string;
  title: string;
  url: string;
  temporary?: boolean;
  active: boolean;
}

export function tempProvider(views: () => TempView[]): ListProvider {
  return () => {
    const items = views()
      .filter((view) => view.type === 'browser' && view.temporary)
      .map(
        (view): ListItem => ({
          key: view.id,
          itemType: 'link',
          title: view.title,
          subtitle: view.url,
          meta: { viewId: view.id, url: view.url },
          state: { open: true, active: view.active },
        }),
      );
    return items.length ? [{ id: 'temp', label: '临时网页', items }] : [];
  };
}
