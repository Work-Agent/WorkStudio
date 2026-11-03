import { expect, test } from '@playwright/test';
import { Host } from '../src/main/framework/host';
import { Router } from '../src/main/router/router';
import { routesPlugins } from '../src/main/router/routes';
import type { PluginsService } from '../src/main/service/plugins';

function service(): PluginsService {
  return {
    installed: () => [],
    runtime: () => [],
    onChange: () => () => undefined,
    onCatalog: () => () => undefined,
    page: (pluginId: string, settings = false) =>
      pluginId === 'demo'
        ? {
            id: 'demo',
            label: 'Demo',
            version: '1.0.0',
            page: '/tmp/demo/index.html',
            settings: '/tmp/demo/settings.html',
            ...(settings ? { page: '/tmp/demo/settings.html' } : {}),
          }
        : null,
  } as unknown as PluginsService;
}

test('插件页面与设置页 provider 解析', async () => {
  const host = new Host();
  routesPlugins(new Router(host).service('plugins', '/plugins'), service());

  const page = host.providers.match('/plugins/page/demo');
  const settings = host.providers.match('/plugins/settings/demo');
  expect(page).not.toBeNull();
  expect(settings).not.toBeNull();

  const call = (path: string, pluginId: string) => ({
    path,
    base: '/plugins',
    params: { pluginId },
    input: { path },
    origin: { type: 'service', id: 'plugins', base: '/plugins' } as const,
  });

  expect((await page!.resolve(call('/plugins/page/demo', 'demo'))).title).toBe(
    'Demo',
  );
  const settingsSpec = await settings!.resolve(
    call('/plugins/settings/demo', 'demo'),
  );
  expect(settingsSpec.title).toBe('Demo 设置');
  expect(settingsSpec.url).toContain('/tmp/demo/settings.html');
});
