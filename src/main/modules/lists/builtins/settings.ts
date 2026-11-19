import type { ListDefinition, ListItem } from '../../../../shared/lists.ts';
import type { SettingsPage } from '../../settings/registry.ts';
import type { ListProvider } from '../registry.ts';
import { OPEN_ACTION } from './common.ts';

export const settingsDefinition: ListDefinition = {
  id: 'settings',
  section: 'settings',
  label: '设置',
  icon: 'sliders',
  tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
  unit: '项',
  order: 60,
  sourceScope: 'app',
  itemType: 'settings',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export function settingsProvider(pages: () => SettingsPage[]): ListProvider {
  return () => {
    const items: ListItem[] = pages().map((page) => ({
      key: page.id,
      itemType: 'settings',
      title: page.label,
      subtitle: page.desc,
      icon: page.icon,
      meta: { pageId: page.id, ref: `settings://${page.id}` },
    }));
    return [{ id: 'settings', label: '设置', items }];
  };
}
