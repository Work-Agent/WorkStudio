import type { DomainRegistry } from '../../runtime/domains.ts';
import type { ResourcesRuntime } from './resources.ts';

export type PluginSurface = 'page' | 'settings';

export interface PluginsDeps {
  runtime(): ResourcesRuntime | null;
  ensure(): Promise<ResourcesRuntime>;
  open(pluginId: string, surface: PluginSurface): Promise<{ id: string }>;
  installed(): unknown[];
  catalog(): unknown;
  catalogRefresh(): Promise<unknown>;
  task(): unknown;
  cancel(): unknown;
  retry(): Promise<void>;
  install(source: string): Promise<void>;
  remove(source: string): Promise<void>;
  reload(source: string): Promise<void>;
}

/** plugins：插件清单 / 页面出口 / 插件自持设置。 */
export function definePluginsDomain(
  registry: DomainRegistry,
  deps: PluginsDeps,
): void {
  const domain = registry.define('plugins');
  const list = domain.resource('list');
  list.snapshot(() => deps.runtime()?.ura.host.pluginInfoList() ?? []);
  list.command<{ pluginId: string; surface?: PluginSurface }, { id: string }>(
    'open',
    (call) =>
      deps.open(
        String(call.input.pluginId),
        call.input.surface === 'settings' ? 'settings' : 'page',
      ),
  );
  list.command<{ pluginId: string; key: string; fallback?: unknown }, unknown>(
    'getSetting',
    async (call) => {
      const runtime = await deps.ensure();
      return runtime.ura.host.getSetting(
        call.input.pluginId,
        call.input.key,
        call.input.fallback,
      );
    },
  );
  const installed = domain.resource('installed');
  installed.snapshot(() => deps.installed());
  const catalog = domain.resource('catalog');
  catalog.snapshot(() => deps.catalog());
  const task = domain.resource('task');
  task.snapshot(() => deps.task());
  list.command<null, unknown>('catalog', () => deps.catalogRefresh());
  task.command<null, unknown>('cancel', () => deps.cancel());
  task.command<null, null>('retry', async () => {
    await deps.retry();
    return null;
  });
  list.command<{ source: string }, null>('install', async (call) => {
    await deps.install(String(call.input.source));
    list.publish();
    installed.publish();
    return null;
  });
  list.command<{ source: string }, null>('remove', async (call) => {
    await deps.remove(String(call.input.source));
    list.publish();
    installed.publish();
    return null;
  });
  list.command<{ source: string }, null>('reload', async (call) => {
    await deps.reload(String(call.input.source));
    list.publish();
    installed.publish();
    return null;
  });

  list.command<{ pluginId: string; key: string; value?: unknown }, unknown>(
    'setSetting',
    async (call) => {
      const runtime = await deps.ensure();
      return runtime.ura.host.setSetting(
        call.input.pluginId,
        call.input.key,
        call.input.value,
      );
    },
  );
}
