/**
 * plugin 模块的 System Domain：安装清单、目录与任务。
 *
 * 已安装清单来自 PluginStore（未激活也算已安装）；阶段来自生命周期。
 */

import type { PluginLifecycle, PluginStage } from '../../plugin/lifecycle.ts';
import type { PluginService } from '../../plugin/service.ts';
import type { CatalogEntry } from '../../plugin/catalog.ts';
import type { PluginStore } from '../../plugin/store.ts';
import { CallFailure, notImplemented } from '../../contract.ts';
import { activeWindowId } from '../shell/domains.ts';
import { pending } from '../../registry/command.ts';
import type { DomainRegistry } from '../../registry/registry.ts';

export interface PluginViewState {
  id: string;
  label: string;
  version: string;
  stage: PluginStage | 'installed';
  hasConfig: boolean;
}

export type PluginCatalogEntry = CatalogEntry;

export interface PluginTaskState {
  id: string;
  status: string;
  progress?: number;
  message?: string;
}

export interface PluginState {
  catalog: PluginCatalogEntry[];
  task: PluginTaskState | null;
}

export function createPluginState(): PluginState {
  return { catalog: [], task: null };
}

export function definePluginResources(
  registry: DomainRegistry,
  state: PluginState,
  store: PluginStore,
  service: PluginService,
  lifecycle: PluginLifecycle,
): void {
  const installed = registry.define('plugin').resource('installed');
  installed.snapshot((): PluginViewState[] =>
    store.list().map((pkg) => ({
      id: pkg.manifest.id,
      label: pkg.manifest.label ?? pkg.manifest.id,
      version: pkg.version,
      stage: lifecycle.stageOf(pkg.manifest.id) ?? 'installed',
      hasConfig: Boolean(pkg.settingsPage),
    })),
  );
  installed.command('refresh', {
    summary: '刷新插件投影',
    args: {},
    run: () => {
      installed.publish();
      return null;
    },
  });
  installed.command('install', {
    summary: '安装插件',
    args: { source: { type: 'string', required: true } },
    run: async (input) => {
      const source = String(input.source);
      state.task = {
        id: source,
        status: 'installing',
        progress: 0,
        message: '正在安装',
      };
      task.publish();
      try {
        const pkg = await service.install(source);
        await service.activate(pkg.manifest.id);
        state.task = {
          id: pkg.manifest.id,
          status: 'ready',
          progress: 100,
          message: '安装完成',
        };
        installed.publish();
        return pkg.manifest.id;
      } catch (error) {
        state.task = {
          id: source,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
        throw error;
      } finally {
        task.publish();
      }
    },
  });
  installed.command('remove', {
    summary: '卸载插件',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      await service.uninstall(String(input.id));
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
    run: async (input) => {
      const id = String(input.id);
      const pkg = store.list().find((item) => item.manifest.id === id);
      if (!pkg) throw new CallFailure('not_found', `插件不存在：${id}`);
      const label = pkg.manifest.label ?? id;
      const windowId = activeWindowId(registry);
      if (!windowId) throw new CallFailure('failed', '没有活动窗口');
      const result = await registry.dispatchCommand(
        { domain: 'shell', resource: `${windowId}/views` },
        'open',
        {
          id: `plugin:${id}:settings`,
          type: 'page',
          title: `${label} 设置`,
          url: `plugin://${id}/settings`,
        },
        {
          origin: { type: 'service', id: 'plugin' },
          changed: (ref, type) => registry.changed(ref, type),
          log: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        },
      );
      if (!result.ok)
        throw new CallFailure(result.error.code, result.error.message);
      return result.data;
    },
  });
  installed.command('activate', {
    summary: '按需激活插件',
    args: { id: { type: 'string', required: true } },
    run: async (input) => {
      await service.activate(String(input.id));
      installed.publish();
      return null;
    },
  });

  const catalog = registry.define('plugin').resource('catalog');
  catalog.snapshot(() => service.catalog()?.entries ?? state.catalog);
  catalog.command('refresh', {
    summary: '刷新插件目录',
    args: {},
    run: async () => {
      const result = await service.refreshCatalog();
      state.catalog = result.entries;
      catalog.publish();
      return result.entries;
    },
  });

  const task = registry.define('plugin').resource('task');
  task.snapshot(() => state.task);
  task.command('cancel', {
    summary: '取消安装任务',
    args: {},
    run: () => {
      state.task = null;
      task.publish();
      return null;
    },
  });
}

/** 占位：插件域尚未提供列表贡献；系统列表只在 workspace 内。 */
export function pluginNotImplemented(name: string): never {
  return notImplemented(name);
}
