import type { ListDefinition, ListItem } from '../../../../shared/lists.ts';
import type { ListProvider } from '../registry.ts';
import { OPEN_ACTION } from './common.ts';

export const sessionsDefinition: ListDefinition = {
  id: 'sessions',
  section: 'hidden',
  label: '会话',
  icon: 'messages',
  tone: 'bg-violet-500 text-violet-50 dark:bg-violet-600 dark:text-violet-100',
  unit: '个会话',
  order: 40,
  sourceScope: 'workspace',
  itemType: 'session',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  empty: { icon: 'messages', text: '暂无会话' },
  grouping: 'flat',
};

export interface SessionListSource {
  activePath: string | null;
  list: Array<{
    path: string;
    name: string;
    preview?: string;
    createdAt: number;
    messageCount?: number;
  }>;
}

export function sessionsProvider(
  source: () => SessionListSource,
): ListProvider {
  return () => {
    const { activePath, list } = source();
    const items: ListItem[] = list.map((session) => ({
      key: session.path,
      itemType: 'session',
      title: session.name,
      subtitle: session.preview ?? '',
      meta: {
        path: session.path,
        updatedAt: session.createdAt,
        messageCount: session.messageCount ?? 0,
      },
      state: { active: session.path === activePath },
    }));
    return [
      {
        id: 'sessions',
        label: '会话',
        items,
        ...(items.length === 0
          ? { empty: { icon: 'messages', text: '暂无会话' } }
          : {}),
      },
    ];
  };
}
