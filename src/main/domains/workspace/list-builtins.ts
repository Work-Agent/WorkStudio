/**
 * 五类系统列表：docs / temp / sessions / plugins / settings。
 *
 * provider 只读注册表快照与传输层，不直接引用其它模块对象。
 * 插件列表 API 暂不开放；这里只做系统投影。
 */

import type {
  ListActionSpec,
  ListDefinition,
  ListGroup,
  ListItem,
} from '../../../shared/lists.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { TransportRouter } from '../../transport/router.ts';
import type { ListProviderContext, ListRegistry } from './lists.ts';

export interface SystemListDeps {
  registry: DomainRegistry;
  transport: TransportRouter;
}

const OPEN_ACTION: ListActionSpec = {
  id: 'open',
  label: '打开',
  icon: 'arrow-up-right',
  scope: 'workspace',
  action: 'list.open',
};

const DOC_FIELDS = [
  { key: 'title', type: 'text' as const },
  { key: 'subtitle', type: 'text' as const },
  { key: 'time', type: 'time' as const },
];

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

export const tempDefinition: ListDefinition = {
  id: 'temp',
  label: '临时网页',
  icon: 'hourglass',
  tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
  unit: '个标签',
  order: 30,
  sourceScope: 'workspace',
  deps: [{ domain: 'shell', resource: 'views' }],
  itemType: 'link',
  fields: [{ key: 'title', type: 'text' }],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export const sessionsDefinition: ListDefinition = {
  id: 'sessions',
  section: 'hidden',
  label: '会话',
  icon: 'messages',
  tone: 'bg-violet-500 text-violet-50 dark:bg-violet-600 dark:text-violet-100',
  unit: '个会话',
  order: 40,
  sourceScope: 'workspace',
  deps: [{ domain: 'agent', resource: 'sessions' }],
  itemType: 'session',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  empty: { icon: 'messages', text: '暂无会话' },
  grouping: 'flat',
};

export const pluginsDefinition: ListDefinition = {
  id: 'plugins',
  section: 'plugins',
  label: '插件',
  icon: 'package',
  tone: 'bg-cyan-500 text-cyan-50 dark:bg-cyan-600 dark:text-cyan-100',
  unit: '个',
  order: 50,
  sourceScope: 'app',
  deps: [{ domain: 'plugin', resource: 'installed' }],
  itemType: 'plugin',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export const settingsDefinition: ListDefinition = {
  id: 'settings',
  section: 'settings',
  label: '设置',
  icon: 'sliders',
  tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
  unit: '项',
  order: 60,
  sourceScope: 'app',
  deps: [{ domain: 'settings', resource: 'pages' }],
  itemType: 'settings',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  grouping: 'flat',
};

export function registerSystemLists(
  lists: ListRegistry,
  deps: SystemListDeps,
): void {
  lists.register(docsDefinition, (ctx) => docsGroup(deps, ctx), 'system');
  lists.register(tempDefinition, (ctx) => tempGroup(deps, ctx), 'system');
  lists.register(
    sessionsDefinition,
    (ctx) => sessionsGroup(deps, ctx),
    'system',
  );
  lists.register(pluginsDefinition, () => pluginsGroup(deps), 'system');
  lists.register(settingsDefinition, () => settingsGroup(deps), 'system');
}

async function docsGroup(
  deps: SystemListDeps,
  ctx: ListProviderContext,
): Promise<ListGroup[]> {
  const root = ctx.workspacePath;
  if (!root) return [];
  const entries = await deps.transport.ls(fileRef(root), { limit: 500 });
  const items: ListItem[] = entries
    .filter(
      (entry) =>
        entry.type === 'file' &&
        !entry.ref.includes('/sites/') &&
        !entry.name.startsWith('.') &&
        entry.name !== 'AGENTS.md',
    )
    .map((entry) => {
      const relative = entry.ref.startsWith(`${fileRef(root)}/`)
        ? entry.ref.slice(fileRef(root).length + 1)
        : entry.name;
      return {
        key: entry.ref,
        itemType: 'document',
        title: entry.name,
        subtitle: '本地文档',
        meta: {
          ref: entry.ref,
          relativePath: relative,
          source: 'docs',
          sourceLabel: '本地文档',
          ...(entry.modifiedAt ? { updatedAt: entry.modifiedAt } : {}),
        },
      };
    });
  return items.length ? [groupOf(docsDefinition, items)] : [];
}

function tempGroup(
  deps: SystemListDeps,
  ctx: ListProviderContext,
): ListGroup[] {
  const views = snapshot<Array<Record<string, unknown>>>(
    deps.registry,
    'shell',
    `${ctx.workspaceId}/views`,
  );
  const items: ListItem[] = (views ?? [])
    .filter((view) => view['type'] === 'web')
    .map((view) => ({
      key: String(view['id'] ?? ''),
      itemType: 'link',
      title: String(view['title'] ?? ''),
      subtitle: String(view['url'] ?? ''),
      meta: {
        viewId: view['id'],
        url: view['url'],
      },
      state: { open: true, active: view['active'] === true },
    }));
  return items.length ? [groupOf(tempDefinition, items)] : [];
}

function sessionsGroup(
  deps: SystemListDeps,
  ctx: ListProviderContext,
): ListGroup[] {
  const snapshotValue = snapshot<Record<string, unknown>>(
    deps.registry,
    'agent',
    `${ctx.workspaceId}/sessions`,
  );
  const items = Array.isArray(snapshotValue?.['items'])
    ? snapshotValue['items']
    : [];
  const list: ListItem[] = items.map((item) => {
    const session = item as Record<string, unknown>;
    const id = String(session['id'] ?? '');
    return {
      key: id,
      itemType: 'session',
      title: String(session['title'] ?? id),
      subtitle: '',
      meta: { path: id, updatedAt: 0, messageCount: 0 },
      state: {
        active:
          snapshotValue?.['current'] !== null &&
          (snapshotValue?.['current'] as Record<string, unknown>)?.['id'] ===
            id,
      },
    };
  });
  return [groupOf(sessionsDefinition, list)];
}

function pluginsGroup(deps: SystemListDeps): ListGroup[] {
  const installed = snapshot<Array<Record<string, unknown>>>(
    deps.registry,
    'plugin',
    'installed',
  );
  const items: ListItem[] = (installed ?? []).map((plugin) => ({
    key: String(plugin['id'] ?? ''),
    itemType: 'plugin',
    title: String(plugin['label'] ?? plugin['id'] ?? ''),
    subtitle: `v${String(plugin['version'] ?? '')}`,
    meta: {
      pluginId: plugin['id'],
      version: plugin['version'],
      hasConfig: plugin['hasConfig'] === true,
    },
  }));
  return [groupOf(pluginsDefinition, items)];
}

function settingsGroup(deps: SystemListDeps): ListGroup[] {
  const pages = snapshot<Array<Record<string, unknown>>>(
    deps.registry,
    'settings',
    'pages',
  );
  const items: ListItem[] = (pages ?? []).map((page) => ({
    key: String(page['id'] ?? ''),
    itemType: 'settings',
    title: String(page['label'] ?? page['id'] ?? ''),
    subtitle: String(page['desc'] ?? ''),
    icon: String(page['icon'] ?? ''),
    meta: { pageId: page['id'], ref: `settings://${page['id']}` },
  }));
  return [groupOf(settingsDefinition, items)];
}

function snapshot<T>(
  registry: DomainRegistry,
  domain: string,
  resource: string,
): T | null {
  return registry.snapshot({ domain, resource }) as T | null;
}

function fileRef(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return `file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

export function groupOf(
  definition: ListDefinition,
  items: ListItem[],
): ListGroup {
  return {
    id: definition.id,
    definitionId: definition.id,
    section: definition.section ?? 'resources',
    label: definition.label,
    ...(definition.icon ? { icon: definition.icon } : {}),
    ...(definition.tone ? { tone: definition.tone } : {}),
    ...(definition.unit ? { unit: definition.unit } : {}),
    countLabel: `${items.length} ${definition.unit ?? '项'}`,
    updatedAt: 0,
    order: definition.order,
    count: items.length,
    state: 'ready',
    fields: definition.fields,
    actions: definition.actions,
    ...(definition.empty ? { empty: definition.empty } : {}),
    items,
  };
}
