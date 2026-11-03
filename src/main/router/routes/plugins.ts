import { RouteFailure } from '../../core/failure';
import { appPageUrl } from '../../core/paths';
import type { RouteCall } from '../../core/types';
import type { PluginsService } from '../../service/plugins';
import type { Router } from '../router';

// ─── plugins ────────────────────────────────────────────

export function routesPlugins(r: Router, service: PluginsService): void {
  const installed = r.state('/installed');
  const runtime = r.state('/runtime');
  const catalog = r.state('/catalog');

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
    async (call: RouteCall<{ pluginId: string; settings?: boolean }>) => {
      const target = service.page(
        call.input.pluginId,
        call.input.settings === true,
      );
      if (!target) {
        throw new RouteFailure(
          'unknown',
          `unknown plugin page: ${call.input.pluginId}`,
        );
      }
      const path = call.input.settings
        ? r.at('/settings/:pluginId', { pluginId: target.id })
        : r.at('/page/:pluginId', { pluginId: target.id });
      return r.call<{ id: string }>('/views/open', { path });
    },
  );

  const resolvePlugin = (
    pluginId: string,
    settings: boolean,
  ): {
    type: 'page';
    url: string;
    title: string;
    preload: 'page';
    grants: { call: string[]; watch: string[] };
  } => {
    const target = service.page(pluginId, settings);
    if (!target) {
      throw new RouteFailure('unknown', `unknown plugin page: ${pluginId}`);
    }
    return {
      type: 'page',
      url: appPageUrl(target.page),
      title: settings ? `${target.label} 设置` : target.label,
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
          '/settings/pages',
          '/workspaces/**',
          '/piconf',
        ],
      },
    };
  };

  r.view({
    path: '/plugins/page/:pluginId',
    resolve: (call) => resolvePlugin(String(call.params['pluginId']), false),
  });
  r.view({
    path: '/plugins/settings/:pluginId',
    resolve: (call) => resolvePlugin(String(call.params['pluginId']), true),
  });
}
