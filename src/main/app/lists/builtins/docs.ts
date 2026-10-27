import type { ListDefinition } from '../../../../shared/lists';
import type { ListProvider } from '../list-registry';
import { DOC_FIELDS, OPEN_ACTION } from './common';

export const docsDefinition: ListDefinition = {
  id: 'docs',
  label: '本地文档',
  icon: 'folder',
  order: 10,
  sourceScope: 'workspace',
  itemType: 'document',
  fields: DOC_FIELDS,
  actions: [OPEN_ACTION],
  empty: { icon: 'folder', text: '暂无本地文档' },
  grouping: 'flat',
};

export const docsProvider: ListProvider = async (ctx) => {
  const items = (await ctx.tree(ctx.workspace, 500))
    .filter(
      (item) =>
        item.type === 'file' &&
        !item.ref.includes('/sites/') &&
        item.name !== 'AGENTS.md' &&
        !item.name.startsWith('.'),
    )
    .map((item) => ({
      key: item.ref,
      itemType: 'document',
      title: item.name,
      subtitle: '本地文档',
      meta: {
        ref: item.ref,
        source: 'docs',
        sourceLabel: '本地文档',
        groupId: 'docs',
        groupTitle: '本地文档',
      },
    }));
  return items.length ? [{ id: 'docs', label: '本地文档', items }] : [];
};
