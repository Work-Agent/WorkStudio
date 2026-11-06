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
  const displayLabel = 'E2E Plugin';
  const card = page.locator('#plugins .card').filter({ hasText: displayLabel });
  await expect(card).toContainText('已加载');
  expect(await card.innerText()).not.toContain(pluginDir);

  await card.getByRole('button', { name: '卸载' }).click();
  await expect(page.locator('#toast')).toContainText('已移除');
  await expect(
    page.locator('#plugins .card').filter({ hasText: displayLabel }),
  ).toHaveCount(0);

  // 卸载后原地重装：热激活必须重新执行注册入口（ESM 缓存已按激活轮次打破）。
  await page.locator('#source').fill(pluginDir);
  await page.locator('#install').click();
  await expect(page.locator('#toast')).toContainText('已安装');
  await expect(
    page.locator('#plugins .card').filter({ hasText: displayLabel }),
  ).toContainText('已加载');
  // 包文件安装成功与注册入口加载失败必须分开报告；修好入口后只重新加载。
  writeFileSync(
    join(pluginDir, 'ura.js'),
    'throw new Error("E2E registration failure"); export {};\n',
  );
  await page.locator('#source').fill(pluginDir);
  await page.locator('#install').click();
  await expect
    .poll(() => shell.evaluate(() => window.appBridge!.peek('/plugins/task')))
    .toMatchObject({
      status: 'failed',
      phase: 'load',
      installed: true,
      loaded: false,
    });
  await expect(page.locator('#install-task')).toContainText('已安装 · 未加载');
  await expect(
    page.locator('#plugins .card').filter({ hasText: 'E2E Plugin' }),
  ).toContainText('E2E registration failure');
  writeFileSync(
    join(pluginDir, 'ura.js'),
    'globalThis.__workstudioSdk?.registerViewAction({ id: "e2e-plugin.action", run: () => undefined }); export {};\n',
  );
  await page
    .locator('#install-task')
    .getByRole('button', { name: '重新加载', exact: true })
    .click();
  await expect
    .poll(() => shell.evaluate(() => window.appBridge!.peek('/plugins/task')))
    .toMatchObject({ status: 'done', installed: true, loaded: true });
});
