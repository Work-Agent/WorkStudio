/**
 * plugin 模块的 System Domain：可安装目录、已安装投影与任务。
 *
 * 已安装清单来自 installed/<id>/package.json 的实时扫描；没有索引。
 * 目录与任务状态分别归 PluginCatalogService / PluginService。
 */

import type { PluginLifecycle } from '../../plugin/lifecycle.ts';
import type { PluginService } from '../../plugin/service.ts';
import type {
  PluginRegistryEntry,
  PluginRegistrySnapshot,
} from '@work-studio/sdk';
import type { CatalogEntry } from '../../plugin/catalog.ts';
import { compareVersions } from '../../plugin/catalog.ts';
import type { PluginStore } from '../../plugin/store.ts';
import { CallFailure } from '../../contract.ts';
import { activeWindowId, type ViewRecord } from '../shell/domains.ts';
import type { CommandContext } from '../../registry/command.ts';
import type { DomainRegistry } from '../../registry/registry.ts';

export type PluginInstalledStage = 'installed' | 'ready' | 'error' | 'broken';

export interface PluginViewState {
  id: string;
  label: string;
  version: string;
  stage: PluginInstalledStage;
  error?: string;
  builtin: boolean;
  hasConfig: boolean;
}

export interface CatalogItemView extends CatalogEntry {
  state: 'available' | 'installed' | 'update';
  installedVersion?: string;
  builtin: boolean;
}

export interface PluginCatalogView {
  entries: CatalogItemView[];
  url: string;
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
  warnings: string[];
}

export function definePluginResources(
  registry: DomainRegistry,
  store: PluginStore,
  service: PluginService,
  lifecycle: PluginLifecycle,
  builtinIds: ReadonlySet<string>,
): void {
  const installed = registry.define('plugin').resource('installed');
  installed.snapshot((): PluginViewState[] => {
    return store.scan().map((item) => {
      const status = lifecycle.statusOf(item.id);
      const message = item.error ?? status.error;
      return {
        id: item.id,
        label: item.package?.manifest.label ?? item.id,
        version: item.package?.version ?? item.version,
        stage: item.error
          ? 'broken'
          : status.stage === 'ready'
            ? 'ready'
            : message
              ? 'error'
              : 'installed',
        ...(message ? { error: message } : {}),
        builtin: builtinIds.has(item.id),
        hasConfig: Boolean(item.package?.settingsPage),
      };
    });
  });
  installed.command('install', {
    summary: '安装插件',
    args: { source: { type: 'string', required: true } },
    run: async (input) => {
      const id = await service.install(String(input.source));
      installed.publish();
      return id;
    },
  });
  installed.command('remove', {
    summary: '卸载插件',
    args: {
      id: { type: 'string', required: true },
      purgeData: { type: 'boolean' },
    },
    run: async (input) => {
      const id = String(input.id);
      try {
        await closePluginViews(registry, id);
      } catch {
        /* 页面关闭失败不阻塞卸载 */
      }
      await service.uninstall(id, input.purgeData === true);
      installed.publish();
      return null;
    },
  });
  installed.command('reload', {
    summary: '重新激活插件',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      await service.reload(String(input.id));
      installed.publish();
      return null;
    },
  });
  installed.command('open', {
    summary: '打开插件设置页',
    args: { id: { type: 'string', required: true } },
    run: (input) => openPluginHome(registry, store, String(input.id)),
  });
  installed.command('reveal', {
    summary: '在文件管理器中打开插件目录',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      const id = String(input.id);
      if (!store.read(id) && !store.scan().some((item) => item.id === id)) {
        throw new CallFailure('not_found', `插件不存在：${id}`);
      }
      const result = await registry.dispatchCommand(
        { domain: 'shell', resource: 'native' },
        'openPath',
        { path: store.pathOf(id) },
        serviceContext(registry),
      );
      if (!result.ok)
        throw new CallFailure(result.error.code, result.error.message);
      return null;
    },
  });

  const catalog = registry.define('plugin').resource('catalog');
  catalog.snapshot(
    (): PluginCatalogView => catalogView(store, service, builtinIds),
  );
  catalog.command('refresh', {
    summary: '刷新插件目录',
    args: {},
    run: async () => {
      const result = await service.refreshCatalog();
      catalog.publish();
      return result;
    },
  });
  catalog.command('setSource', {
    summary: '设置插件目录地址',
    args: { url: { type: 'string' } },
    run: async (input) => {
      const url = typeof input.url === 'string' ? input.url : '';
      const result = await service.setCatalogUrl(url);
      catalog.publish();
      return result;
    },
  });

  const task = registry.define('plugin').resource('task');
  task.snapshot(() => service.task);
  task.command('cancel', {
    summary: '取消安装任务',
    args: {},
    run: async () => {
      await service.cancel();
      return null;
    },
  });
  task.command('clear', {
    summary: '清除已结束的安装任务',
    args: {},
    run: () => {
      service.clearTask();
      return null;
    },
  });

  const pluginRegistry = registry.define('plugin').resource('registry');
  pluginRegistry.snapshot(
    (): PluginRegistrySnapshot =>
      registrySnapshot(store, service, lifecycle, builtinIds),
  );
  pluginRegistry.command('install', {
    summary: '按目录条目安装插件',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      await service.install(`catalog:${String(input.id)}`);
      pluginRegistry.publish();
      return null;
    },
  });
  pluginRegistry.command('remove', {
    summary: '卸载插件',
    args: {
      id: { type: 'string', required: true },
      purgeData: { type: 'boolean' },
    },
    run: async (input) => {
      const id = String(input.id);
      try {
        await closePluginViews(registry, id);
      } catch {
        /* 页面关闭失败不阻塞卸载 */
      }
      await service.uninstall(id, input.purgeData === true);
      pluginRegistry.publish();
      return null;
    },
  });
  pluginRegistry.command('reload', {
    summary: '重新激活插件',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      await service.reload(String(input.id));
      pluginRegistry.publish();
      return null;
    },
  });
  pluginRegistry.command('refresh', {
    summary: '刷新插件目录',
    args: {},
    run: async () => {
      await service.refreshCatalog();
      pluginRegistry.publish();
      return null;
    },
  });
  pluginRegistry.command('installSource', {
    summary: '从 URL / 文件 / 目录安装插件',
    args: { source: { type: 'string', required: true } },
    run: async (input) => {
      await service.install(String(input.source));
      pluginRegistry.publish();
      return null;
    },
  });
  pluginRegistry.command('cancel', {
    summary: '取消当前安装任务',
    args: {},
    run: async () => {
      await service.cancel();
      return null;
    },
  });
  pluginRegistry.command('clearTask', {
    summary: '清除已结束的安装任务',
    args: {},
    run: () => {
      service.clearTask();
      return null;
    },
  });
  pluginRegistry.command('open', {
    summary: '打开插件设置页',
    args: { id: { type: 'string', required: true } },
    run: (input) => openPluginHome(registry, store, String(input.id)),
  });

  service.onChange((type) => {
    if (type === 'task') {
      task.publish();
      pluginRegistry.publish();
      return;
    }
    if (type === 'installed') {
      installed.publish();
      catalog.publish();
      pluginRegistry.publish();
      return;
    }
    catalog.publish();
    pluginRegistry.publish();
  });
}

function catalogView(
  store: PluginStore,
  service: PluginService,
  builtinIds: ReadonlySet<string>,
): PluginCatalogView {
  const versions = new Map(
    store
      .scan()
      .map((item) => [item.id, item.package?.version ?? item.version]),
  );
  const result = service.catalog();
  return {
    entries: result.entries.map((entry) => {
      const installedVersion = versions.get(entry.id);
      return {
        ...entry,
        ...(installedVersion ? { installedVersion } : {}),
        state: !installedVersion
          ? 'available'
          : compareVersions(installedVersion, entry.version) >= 0
            ? 'installed'
            : 'update',
        builtin: builtinIds.has(entry.id),
      };
    }),
    url: result.url,
    fetchedAt: result.fetchedAt,
    stale: result.stale,
    error: result.error ?? null,
    warnings: result.warnings ?? [],
  };
}

function registrySnapshot(
  store: PluginStore,
  service: PluginService,
  lifecycle: PluginLifecycle,
  builtinIds: ReadonlySet<string>,
): PluginRegistrySnapshot {
  const installed: PluginRegistryEntry[] = store.scan().map((item) => {
    const status = lifecycle.statusOf(item.id);
    const message = item.error ?? status.error;
    const stage = item.error
      ? 'broken'
      : status.stage === 'ready'
        ? 'ready'
        : message
          ? 'error'
          : 'installed';
    return {
      id: item.id,
      name: item.package?.manifest.label ?? item.id,
      version: item.package?.version ?? item.version,
      stage,
      state: stage === 'broken' ? 'broken' : 'installed',
      ...(message ? { error: message } : {}),
      builtin: builtinIds.has(item.id),
      hasConfig: Boolean(item.package?.settingsPage),
    };
  });
  const versions = new Map(installed.map((entry) => [entry.id, entry.version]));
  const catalog = service.catalog();
  const available: PluginRegistryEntry[] = [];
  for (const entry of catalog.entries) {
    const installedVersion = versions.get(entry.id);
    if (!installedVersion) {
      available.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        state: 'available',
        builtin: builtinIds.has(entry.id),
        hasConfig: false,
      });
      continue;
    }
    if (compareVersions(installedVersion, entry.version) < 0) {
      available.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        installedVersion,
        state: 'update',
        builtin: builtinIds.has(entry.id),
        hasConfig: false,
      });
    }
  }
  return {
    revision: Date.now(),
    installed,
    available,
    catalog: {
      fetchedAt: catalog.fetchedAt,
      stale: catalog.stale,
      ...(catalog.error ? { error: catalog.error } : {}),
    },
    task: service.task,
  };
}

/** 插件主页：有设置页走 settings；没有设置页回退到内容页。 */
async function openPluginHome(
  registry: DomainRegistry,
  store: PluginStore,
  id: string,
): Promise<unknown> {
  const pkg = store.read(id);
  if (!pkg) throw new CallFailure('not_found', `插件不存在或已损坏：${id}`);
  const label = pkg.manifest.label ?? id;
  const surface = pkg.settingsPage ? 'settings' : 'content';
  const windowId = activeWindowId(registry);
  if (!windowId) throw new CallFailure('failed', '没有活动窗口');
  const result = await registry.dispatchCommand(
    { domain: 'shell', resource: `${windowId}/views` },
    'open',
    {
      id: `plugin:${id}:${surface}`,
      type: 'page',
      title: surface === 'settings' ? `${label} 设置` : label,
      url: `plugin://${id}/${surface}`,
    },
    serviceContext(registry),
  );
  if (!result.ok)
    throw new CallFailure(result.error.code, result.error.message);
  return result.data;
}

function serviceContext(registry: DomainRegistry): CommandContext {
  return {
    origin: { type: 'service', id: 'plugin' },
    changed: (ref, type) => registry.changed(ref, type),
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

async function closePluginViews(
  registry: DomainRegistry,
  pluginId: string,
): Promise<void> {
  const prefix = `plugin://${pluginId}/`;
  const state = registry.snapshot({
    domain: 'shell',
    resource: 'windows',
  }) as { windows?: Array<{ id: string }> } | null;
  for (const window of state?.windows ?? []) {
    const views = registry.snapshot({
      domain: 'shell',
      resource: `${window.id}/views`,
    }) as ViewRecord[] | null;
    for (const view of views ?? []) {
      if (!view.url?.startsWith(prefix)) continue;
      await registry.dispatchCommand(
        { domain: 'shell', resource: `${window.id}/views` },
        'close',
        { id: view.id },
        serviceContext(registry),
      );
    }
  }
}
