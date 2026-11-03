import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { Host } from '../src/main/framework/host';
import { Router } from '../src/main/router/router';
import { routesSettings } from '../src/main/router/routes';
import type { SettingsService } from '../src/main/service/settings';

test('设置页 provider 解析到内置页面', async () => {
  const root = mkdtempSync(join(tmpdir(), 'next-settings-'));
  const service = {
    pages: () => [],
    storage: () => ({
      dataRoot: root,
      dataRootSource: 'configured',
      workspacePath: root,
      workspaceId: 'e2e',
      agentDir: root,
      modelsJson: '',
      authJson: '',
      globalSettings: '',
      workspaceSettings: '',
      sessionsDir: '',
      defaultSessionsDir: '',
      sessionsDirConfigured: null,
      sceneFile: '',
      appPath: '',
      sitesDir: '',
      pluginsDirs: [],
      bootLog: '',
      versions: { app: '', electron: '', chrome: '', node: '' },
    }),
    setDataRoot: () => undefined,
    page: (id: string) =>
      id === 'plugins'
        ? {
            id,
            label: '插件',
            page: join(root, 'settings', 'plugins', 'index.html'),
          }
        : null,
  } as unknown as SettingsService;
  const host = new Host();
  routesSettings(new Router(host).service('settings', '/settings'), service);

  const provider = host.providers.match('/settings/page/plugins');
  expect(provider).not.toBeNull();
  const spec = await provider!.resolve({
    path: '/settings/page/plugins',
    base: '/settings',
    params: { pageId: 'plugins' },
    input: { path: '/settings/page/plugins' },
    origin: { type: 'service', id: 'settings', base: '/settings' },
  });
  expect(spec.title).toBe('插件');
  expect(spec.url).toContain('/settings/plugins/index.html');
  expect(spec.preload).toBe('page');
});
