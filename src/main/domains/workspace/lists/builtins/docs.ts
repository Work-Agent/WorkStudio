import type { ListDefinition } from '../../../../../shared/lists.ts';
import type { ListProvider } from '../registry.ts';
import { DOC_FIELDS, OPEN_ACTION } from './common.ts';
import { mtimeOf } from './file-time.ts';

export const docsDefinition: ListDefinition = {
  id: 'docs',
  label: '本地文档',
  icon: 'folder',
  tone: 'bg-amber-500 text-amber-50 dark:bg-amber-600 dark:text-amber-100',
  unit: '项',
  order: 10,
  sourceScope: 'workspace',
  itemType: 'document',
  fields: DOC_FIELDS,
  actions: [OPEN_ACTION],
  empty: { icon: 'folder', text: '暂无本地文档' },
  grouping: 'flat',
};

export const docsProvider: ListProvider = async (ctx) => {
  const root = ctx.workspace.replace(/\/+$/, '');
  const files = (await ctx.tree(ctx.workspace, 500)).filter(
    (item) =>
      item.type === 'file' &&
      !item.ref.includes('/sites/') &&
      item.name !== 'AGENTS.md' &&
      !item.name.startsWith('.'),
  );
  const items = await Promise.all(
    files.map(async (item) => {
      const updatedAt = await mtimeOf(item.ref);
      const icon = ctx.icon?.(item.ref);
      const relativePath = item.ref.startsWith(`${root}/`)
        ? item.ref.slice(root.length + 1)
        : item.name;
      return {
        key: item.ref,
        itemType: 'document',
        title: item.name,
        subtitle: '本地文档',
        ...(icon ? { icon } : {}),
        meta: {
          ref: item.ref,
          relativePath,
          source: 'docs',
          sourceLabel: '本地文档',
          groupId: 'docs',
          groupTitle: '本地文档',
          ...(updatedAt ? { updatedAt } : {}),
        },
      };
    }),
  );
  return items.length ? [{ id: 'docs', label: '本地文档', items }] : [];
};
