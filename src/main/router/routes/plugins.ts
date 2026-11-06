import { RouteFailure } from '../../core/failure';
import { appPageUrl } from '../../core/paths';
import type { RouteCall } from '../../core/types';
import type { PluginsService } from '../../service/plugins';
import type { Router } from '../router';

// ─── plugins ────────────────────────────────────────────

/** 插件页面出口：文档查看器（page）/ 配置面（settings）。入口必须显式指定。 */
export type PluginSurface = 'page' | 'settings';

const SURFACE_LABEL: Record<PluginSurface, string> = {
  page: '页面',
  settings: '配置页',
};

function surfaceOf(value: unknown): PluginSurface {
  if (value === 'page' || value === 'settings') return value;
  throw new RouteFailure('invalid', 'surface 必须是 page 或 settings');
}

/** 按出口取页面文件；未知插件与缺该出口分别报错，不做兜底。 */
function pageFileOf(
  service: PluginsService,
  pluginId: string,
  surface: PluginSurface,
): { label: string; id: string; file: string } {
  const entry = service.entry(pluginId);
  if (!entry) {
    throw new RouteFailure('unknown', `未知插件：${pluginId}`);
  }
  const file = surface === 'settings' ? entry.settings : entry.page;
  if (!file) {
    throw new RouteFailure(
      'failed',
      `插件没有${SURFACE_LABEL[surface]}：${pluginId}`,
    );
  }
  return { id: entry.id, label: entry.label, file };
}

export function routesPlugins(r: Router, service: PluginsService): void {
  const installed = r.state('/installed');
  const runtime = r.state('/runtime');
  const catalog = r.state('/catalog');
  const task = r.state('/task');
  task.publish(service.task);
  service.onTask((value) => task.publish(value));
  r.handle('/install/cancel', () => service.cancelInstall());
  r.handle('/install/retry', () => service.retryInstall());
  r.handle('/reload', (call: RouteCall<{ source: string }>) =>
    service.install(call.input.source, true),
  );

  const publish = (): void => {
    installed.publish(service.installed());
    runtime.publish(service.runtime());
  };
  service.onChange(publish);
  service.onCatalog((result) => catalog.publish(result));
  publish();

  r.handle('/refresh', () => {
    publish();
    return { ok: true };
  });
  r.handle('/install', (call: RouteCall<{ source: string }>) =>
    service.install(call.input.source),
  );
  r.handle('/remove', async (call: RouteCall<{ source: string }>) => ({
    removed: await service.remove(call.input.source),
  }));
  r.handle('/catalog/refresh', (call: RouteCall<{ url?: string }>) =>
    service.refreshCatalog(call.input.url),
  );
  r.handle(
    '/settings/get',
    (call: RouteCall<{ pluginId: string; key: string; fallback?: unknown }>) =>
      service.getSetting(
        call.input.pluginId,
        call.input.key,
        call.input.fallback,
      ),
  );
  r.handle(
    '/settings/set',
    (call: RouteCall<{ pluginId: string; key: string; value: unknown }>) =>
      service.setSetting(call.input.pluginId, call.input.key, call.input.value),
  );
  r.handle(
    '/open',
    async (call: RouteCall<{ pluginId: string; surface: PluginSurface }>) => {
      const surface = surfaceOf(call.input.surface);
      const target = pageFileOf(service, call.input.pluginId, surface);
      const path =
        surface === 'settings'
          ? r.at('/settings/:pluginId', { pluginId: target.id })
          : r.at('/page/:pluginId', { pluginId: target.id });
      return r.call<{ id: string }>('/views/open', { path });
    },
  );

  const resolvePlugin = (
    pluginId: string,
    surface: PluginSurface,
  ): {
    type: 'page';
    url: string;
    title: string;
    preload: 'page';
    grants: { call: string[]; watch: string[] };
  } => {
    const target = pageFileOf(service, pluginId, surface);
    return {
      type: 'page',
      url: appPageUrl(target.file),
      title: surface === 'settings' ? `${target.label} 设置` : target.label,
      preload: 'page',
      grants: {
        call: [
          '/plugins/**',
          '/settings/**',
          '/workspaces/**',
          '/piconf/**',
          '/native/**',
        ],
        watch: [
          '/plugins/installed',
          '/plugins/catalog',
          '/plugins/task',
          '/plugins/runtime',
          '/settings/pages',
          '/workspaces/**',
          '/piconf',
        ],
      },
    };
  };

  r.view({
    path: '/plugins/page/:pluginId',
    resolve: (call) => resolvePlugin(String(call.params['pluginId']), 'page'),
  });
  r.view({
    path: '/plugins/settings/:pluginId',
    resolve: (call) =>
      resolvePlugin(String(call.params['pluginId']), 'settings'),
  });
}
