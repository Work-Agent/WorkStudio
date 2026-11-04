import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../support/app';
import { openSettings } from '../support/commands';
import { windowByUrl } from '../support/fixtures';

test('安装并卸载本地插件来源', async ({ shell, electron, dataDir }) => {
  const pluginDir = join(dataDir, 'fixtures', 'e2e-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'package.json'),
    JSON.stringify(
      {
        name: 'e2e-plugin',
        version: '1.0.0',
        workstudio: {
          id: 'e2e-plugin',
          label: 'E2E Plugin',
          page: 'index.html',
        },
        exports: { './ura': './ura.js' },
      },
      null,
      2,
    ),
    'utf-8',
  );
  writeFileSync(
    join(pluginDir, 'ura.js'),
    'globalThis.__workstudioSdk?.registerViewAction({ id: "e2e-plugin.action", run: () => undefined });\nexport {};\n',
    'utf-8',
  );
  writeFileSync(
    join(pluginDir, 'index.html'),
    '<h1>E2E Plugin</h1>\n',
    'utf-8',
  );

  await openSettings(shell, 'plugins');
  const page = await windowByUrl(
    electron.app,
    /settings\/plugins\/index\.html/,
  );

  await page.locator('#source').fill(pluginDir);
  await page.locator('#install').click();
  await expect(page.locator('#toast')).toContainText('已安装');
  const displayLabel = 'fixtures/e2e-plugin';
  const card = page.locator('.card').filter({ hasText: displayLabel });
  await expect(card).toContainText('已安装');
  expect(await card.innerText()).not.toContain(pluginDir);

  await card.getByRole('button', { name: '卸载' }).click();
  await expect(page.locator('#toast')).toContainText('已移除');
  await expect(
    page.locator('.card').filter({ hasText: displayLabel }),
  ).toHaveCount(0);

  // 卸载后原地重装：热激活必须重新执行注册入口（ESM 缓存已按激活轮次打破）。
  await page.locator('#source').fill(pluginDir);
  await page.locator('#install').click();
  await expect(page.locator('#toast')).toContainText('已安装');
  await expect(
    page.locator('.card').filter({ hasText: displayLabel }),
  ).toContainText('已安装');
});
