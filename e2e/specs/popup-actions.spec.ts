import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../support/app';
import { openSettings, switchWorkspace } from '../support/commands';
import { windowByUrl } from '../support/fixtures';

test('会话重命名和删除使用统一弹窗，取消保留数据，确认后才写盘', async ({
  shell,
  electron,
  dataDir,
}) => {
  const root = join(dataDir, 'fixtures', 'session-popups');
  mkdirSync(root, { recursive: true });
  await switchWorkspace(shell, root);
  const workspace = await shell.evaluate(() =>
    window.appBridge!.peek<{ id: string }>('/workspaces/current'),
  );
  const directory = join(dataDir, 'workspaces', workspace!.id, 'sessions');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'popup-session.jsonl');
  const timestamp = new Date().toISOString();
  writeFileSync(
    file,
    [
      {
        type: 'session',
        version: 3,
        id: 'popup-session',
        timestamp,
        cwd: root,
      },
      {
        type: 'session_info',
        id: 'info',
        parentId: null,
        timestamp,
        name: '原会话名称',
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
  );
  await shell.evaluate(
    (id) => window.appBridge!.call(`/workspaces/${id}/sessions/list/refresh`),
    workspace!.id,
  );
  await openSettings(shell, 'sessions');
  const page = await windowByUrl(
    electron.app,
    /settings\/sessions\/index\.html/,
  );
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  const row = page.locator('#list .item').filter({ hasText: '原会话名称' });
  await row.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(overlay.getByRole('textbox')).toHaveValue('原会话名称');
  await overlay.getByRole('textbox').fill('不应写入的名称');
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  await expect(row).toBeVisible();
  expect(readFileSync(file, 'utf8')).not.toContain('不应写入的名称');
  await row.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(overlay.getByRole('textbox')).toHaveValue('原会话名称');
  await overlay.getByRole('textbox').fill('  重命名后的会话  ');
  await overlay.getByRole('textbox').press('Enter');
  const renamed = page
    .locator('#list .item')
    .filter({ hasText: '重命名后的会话' });
  await expect(renamed).toBeVisible();
  expect(readFileSync(file, 'utf8')).toContain('"name":"重命名后的会话"');
  await renamed.getByRole('button', { name: '删除', exact: true }).click();
  await expect(overlay.getByRole('dialog')).toContainText('重命名后的会话');
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  expect(existsSync(file)).toBe(true);
  await expect(renamed).toBeVisible();
  await renamed.getByRole('button', { name: '删除', exact: true }).click();
  await overlay.getByRole('button', { name: '确认', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
});

test('删除自定义模型和供应商经统一弹窗确认，取消不修改配置', async ({
  shell,
  electron,
  dataDir,
}) => {
  const root = join(dataDir, 'fixtures', 'model-popups');
  mkdirSync(root, { recursive: true });
  await switchWorkspace(shell, root);
  const providerId = 'popup-provider';
  const results = await shell.evaluate(async (providerId) => {
    const saved = await window.appBridge!.call('/piconf/models/save-provider', {
      providerId,
      config: {
        name: '弹窗测试供应商',
        baseUrl: 'http://127.0.0.1:1/v1',
        api: 'openai-completions',
      },
    });
    const model = await window.appBridge!.call('/piconf/models/save-model', {
      providerId,
      model: {
        id: 'popup-model',
        name: '弹窗测试模型',
        contextWindow: 32000,
        maxTokens: 2000,
        input: ['text'],
        reasoning: false,
      },
    });
    return [saved.ok, model.ok];
  }, providerId);
  expect(results).toEqual([true, true]);
  const config = () =>
    JSON.parse(readFileSync(join(dataDir, 'models.json'), 'utf8')).providers[
      providerId
    ];
  await openSettings(shell, 'models');
  const page = await windowByUrl(electron.app, /settings\/models\/index\.html/);
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  await page.locator('#prov-only-ready').uncheck();
  await page.locator('#prov-filter').fill(providerId);
  await page
    .locator(`[data-action="toggle-prov"][data-pid="${providerId}"]`)
    .click();
  const removeModel = page.locator(
    `[data-action="delete-model"][data-pid="${providerId}"]`,
  );
  await removeModel.click();
  await expect(overlay.getByRole('dialog')).toContainText('popup-model');
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  expect(config().models).toHaveLength(1);
  await removeModel.click();
  await overlay.getByRole('button', { name: '确认', exact: true }).click();
  await expect(removeModel).toHaveCount(0);
  expect(config().models).toHaveLength(0);
  const removeProvider = page.locator(
    `[data-action="delete-provider"][data-pid="${providerId}"]`,
  );
  await removeProvider.click();
  await expect(overlay.getByRole('dialog')).toContainText(providerId);
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  expect(config()).toBeDefined();
  await removeProvider.click();
  await overlay.getByRole('button', { name: '确认', exact: true }).click();
  await expect(removeProvider).toHaveCount(0);
  expect(config()).toBeUndefined();
});
