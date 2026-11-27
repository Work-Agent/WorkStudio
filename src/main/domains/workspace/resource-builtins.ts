/**
 * 系统资源组：docs / sites / temp / sessions / settings。
 *
 * 文件列表是森林；docs 是一棵 transport 树，sites 是「域 → 页」两层，
 * 其余组是只有叶子的树。插件注册表是 App 级独立资源，不在资源森林里。
 */

import type {
  ResourceActionSpec,
  ResourceGroupDefinition,
  ResourceGroup,
  ResourceNode,
} from '../../../shared/resources.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { TransportRouter } from '../../transport/router.ts';
import {
  buildTransportRoots,
  fileRef,
  makeResourceGroup,
} from './resource-tree.ts';
import type { SnapshotEntry } from '../../../shared/snapshots.ts';
import { groupSnapshots } from '../../../shared/snapshots.ts';
import type { ResourceContext, ResourceGroupRegistry } from './resources.ts';

export interface SystemResourceDeps {
  registry: DomainRegistry;
  transport: TransportRouter;
  /** 网页快照清单（web cache）；由组合根注入，工作区模块不直接持有缓存。 */
  snapshots?: () => readonly SnapshotEntry[];
}

const OPEN_ACTION: ResourceActionSpec = {
  id: 'open',
  label: '打开',
  icon: 'arrow-up-right',
  scope: 'workspace',
  action: 'open',
};

const DOC_FIELDS = [
  { key: 'title', type: 'text' as const },
  { key: 'subtitle', type: 'text' as const },
  { key: 'time', type: 'time' as const },
];

export const docsDefinition: ResourceGroupDefinition = {
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
};

/** 网站快照：域 → 页两层，条目打开实时网页（不是快照正文）。 */
export const sitesDefinition: ResourceGroupDefinition = {
  id: 'sites',
  label: '网站快照',
  icon: 'globe',
  tone: 'bg-sky-500 text-sky-50 dark:bg-sky-600 dark:text-sky-100',
  unit: '页',
  order: 20,
  sourceScope: 'workspace',
  deps: [{ domain: 'web', resource: 'web' }],
  itemType: 'link',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
  empty: { icon: 'globe', text: '暂无网站快照' },
};

export const tempDefinition: ResourceGroupDefinition = {
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
};

export const sessionsDefinition: ResourceGroupDefinition = {
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
};

export const settingsDefinition: ResourceGroupDefinition = {
  id: 'settings',
  section: 'settings',
  label: '设置',
  icon: 'sliders',
  tone: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
  unit: '项',
  order: 60,
  sourceScope: 'workspace',
  deps: [{ domain: 'settings', resource: 'pages' }],
  itemType: 'settings',
  fields: [
    { key: 'title', type: 'text' },
    { key: 'subtitle', type: 'text' },
  ],
  actions: [OPEN_ACTION],
};

export function registerSystemResources(
  resources: ResourceGroupRegistry,
  deps: SystemResourceDeps,
): void {
  resources.register(docsDefinition, (ctx) => docsGroup(deps, ctx), 'system');
  resources.register(sitesDefinition, () => sitesGroup(deps), 'system');
  resources.register(tempDefinition, (ctx) => tempGroup(deps, ctx), 'system');
  resources.register(
    sessionsDefinition,
    (ctx) => sessionsGroup(deps, ctx),
    'system',
  );
  resources.register(settingsDefinition, () => settingsGroup(deps), 'system');
}

/** 每采集过一个站点就是一棵根树：域名做组名与图标，页面直接挂在下面。 */
async function sitesGroup(deps: SystemResourceDeps): Promise<ResourceGroup[]> {
  const entries = deps.snapshots?.() ?? [];
  return groupSnapshots(entries).map((group) => {
    const roots: ResourceNode[] = group.items.map((item) => ({
      key: `web:${item.url}`,
      type: 'item',
      title: item.title || item.url,
      subtitle: item.url,
      ...(item.icon ? { icon: item.icon } : {}),
      meta: { url: item.url },
      actions: ['open'],
    }));
    const icon = group.items.find((item) => item.icon)?.icon ?? 'globe';
    return {
      id: `sites:${group.domain}`,
      definitionId: sitesDefinition.id,
      section: sitesDefinition.section ?? 'resources',
      label: group.domain,
      icon,
      ...(sitesDefinition.tone ? { tone: sitesDefinition.tone } : {}),
      ...(sitesDefinition.unit ? { unit: sitesDefinition.unit } : {}),
      count: roots.length,
      countLabel: `${roots.length} ${sitesDefinition.unit ?? '页'}`,
      updatedAt: Math.max(...group.items.map((item) => item.capturedAt)),
      order: sitesDefinition.order ?? 20,
      state: 'ready',
      fields: sitesDefinition.fields,
      actions: sitesDefinition.actions,
      roots,
    };
  });
}

async function docsGroup(
  deps: SystemResourceDeps,
  ctx: ResourceContext,
): Promise<ResourceGroup[]> {
  const root = ctx.workspacePath;
  if (!root) return [];
  const { roots, count } = await buildTransportRoots(
    deps.transport,
    fileRef(root),
  );
  return roots.length ? [makeResourceGroup(docsDefinition, roots, count)] : [];
}

function tempGroup(
  deps: SystemResourceDeps,
  ctx: ResourceContext,
): ResourceGroup[] {
  const views = snapshot<Array<Record<string, unknown>>>(
    deps.registry,
    'shell',
    `${ctx.workspaceId}/views`,
  );
  const roots: ResourceNode[] = (views ?? [])
    .filter((view) => view['type'] === 'web')
    .map((view) => ({
      key: String(view['id'] ?? ''),
      type: 'item',
      title: String(view['title'] ?? ''),
      subtitle: String(view['url'] ?? ''),
      meta: {
        viewId: view['id'],
        url: view['url'],
      },
      state: { open: true, active: view['active'] === true },
      actions: ['open'],
    }));
  return roots.length
    ? [makeResourceGroup(tempDefinition, roots, roots.length)]
    : [];
}

function sessionsGroup(
  deps: SystemResourceDeps,
  ctx: ResourceContext,
): ResourceGroup[] {
  const snapshotValue = snapshot<Record<string, unknown>>(
    deps.registry,
    'agent',
    `${ctx.workspaceId}/sessions`,
  );
  const items = Array.isArray(snapshotValue?.['items'])
    ? snapshotValue['items']
    : [];
  const roots: ResourceNode[] = items.map((item) => {
    const session = item as Record<string, unknown>;
    const id = String(session['id'] ?? '');
    return {
      key: id,
      type: 'item',
      title: String(session['title'] ?? id),
      subtitle: '',
      meta: { path: id, updatedAt: 0, messageCount: 0 },
      state: {
        active:
          snapshotValue?.['current'] !== null &&
          (snapshotValue?.['current'] as Record<string, unknown>)?.['id'] ===
            id,
      },
      actions: ['open'],
    };
  });
  return [makeResourceGroup(sessionsDefinition, roots, roots.length)];
}

function settingsGroup(deps: SystemResourceDeps): ResourceGroup[] {
  const pages = snapshot<Array<Record<string, unknown>>>(
    deps.registry,
    'settings',
    'pages',
  );
  const roots: ResourceNode[] = (pages ?? []).map((page) => ({
    key: String(page['id'] ?? ''),
    type: 'item',
    title: String(page['label'] ?? page['id'] ?? ''),
    subtitle: String(page['desc'] ?? ''),
    icon: String(page['icon'] ?? 'sliders'),
    meta: { pageId: page['id'] },
    actions: ['open'],
  }));
  return [makeResourceGroup(settingsDefinition, roots, roots.length)];
}

function snapshot<T>(
  registry: DomainRegistry,
  domain: string,
  resource: string,
): T | null {
  return registry.snapshot({ domain, resource }) as T | null;
}
