import { expect, test } from '@playwright/test';
import { Host } from '../../src/main/framework/host';
import { Router } from '../../src/main/router/router';
import { routesPlugins } from '../../src/main/router/routes';
import type { PluginsService } from '../../src/main/service/plugins';

/**
 * 插件页面出口的契约：
 *   page     = 文档查看器（由资源打开，带文档与页面会话）
 *   settings = 配置面（由插件入口打开）
 * 入口必须显式指定出口；缺哪个出口就报哪个错，不做兜底。
 */
function service(): PluginsService {
  const entries: Record<string, unknown> = {
    demo: {
      id: 'demo',
      label: 'Demo',
      version: '1.0.0',
      page: '/tmp/demo/index.html',
      settings: '/tmp/demo/settings.html',
    },
    'page-only': {
      id: 'page-only',
      label: 'Page Only',
      version: '1.0.0',
      page: '/tmp/page-only/index.html',
    },
    'settings-only': {
      id: 'settings-only',
      label: 'Settings Only',
      version: '1.0.0',
      settings: '/tmp/settings-only/settings.html',
    },
  };
  return {
    installed: () => [],
    runtime: () => [],
    onChange: () => () => undefined,
    onCatalog: () => () => undefined,
    entry: (pluginId: string) => entries[pluginId] ?? null,
  } as unknown as PluginsService;
}

function harness(): Host {
  const host = new Host();
  routesPlugins(new Router(host).service('plugins', '/plugins'), service());
  return host;
}

const origin = { type: 'service', id: 'plugins', base: '/plugins' } as const;

function call(path: string, pluginId: string) {
  return {
    path,
    base: '/plugins',
    params: { pluginId },
    input: { path },
    origin,
  };
}

test('插件页面与设置页 provider 解析', async () => {
  const host = harness();
  const page = host.providers.match('/plugins/page/demo');
  const settings = host.providers.match('/plugins/settings/demo');
  expect(page).not.toBeNull();
  expect(settings).not.toBeNull();

  expect((await page!.resolve(call('/plugins/page/demo', 'demo'))).title).toBe(
    'Demo',
  );
  const settingsSpec = await settings!.resolve(
    call('/plugins/settings/demo', 'demo'),
  );
  expect(settingsSpec.title).toBe('Demo 设置');
  expect(settingsSpec.url).toContain('/tmp/demo/settings.html');
});

test('只有配置页的插件也能从插件入口打开', async () => {
  const host = harness();
  const spec = await host.providers
    .match('/plugins/settings/settings-only')!
    .resolve(call('/plugins/settings/settings-only', 'settings-only'));
  expect(spec.url).toContain('/tmp/settings-only/settings.html');

  // 同一个插件没有渲染页：要 page 出口必须报错，而不是退化成配置页。
  await expect(async () =>
    host.providers
      .match('/plugins/page/settings-only')!
      .resolve(call('/plugins/page/settings-only', 'settings-only')),
  ).rejects.toThrow(/插件没有页面/);
});

test('插件入口缺出口时按面报错，不静默兜底', async () => {
  const host = harness();

  await expect(async () =>
    host.providers
      .match('/plugins/settings/page-only')!
      .resolve(call('/plugins/settings/page-only', 'page-only')),
  ).rejects.toThrow(/插件没有配置页：page-only/);

  await expect(async () =>
    host.providers
      .match('/plugins/page/nope')!
      .resolve(call('/plugins/page/nope', 'nope')),
  ).rejects.toThrow(/未知插件：nope/);
});

test('plugins/open 必须显式声明出口', async () => {
  const host = harness();

  const missing = await host.call(origin, '/plugins/open', {
    pluginId: 'demo',
  });
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error.code).toBe('invalid');

  const bad = await host.call(origin, '/plugins/open', {
    pluginId: 'demo',
    surface: 'home',
  });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.error.code).toBe('invalid');

  const noSettings = await host.call(origin, '/plugins/open', {
    pluginId: 'page-only',
    surface: 'settings',
  });
  expect(noSettings.ok).toBe(false);
  if (!noSettings.ok) {
    expect(noSettings.error.code).toBe('failed');
    expect(noSettings.error.message).toContain('插件没有配置页');
  }
});
