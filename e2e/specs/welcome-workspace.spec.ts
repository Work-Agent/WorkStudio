import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base } from '@playwright/test';
import { currentPath } from '../support/commands';
import {
  closeApp,
  launchApp,
  shellWindow,
  windowByUrl,
  type AppFixture,
} from '../support/fixtures';

const test = base.extend<{
  studio: AppFixture & { workspace: string; target: string; missing: string };
}>({
  // eslint-disable-next-line no-empty-pattern
  studio: async ({}, use) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'work-studio-welcome-'));
    const workspace = join(dataDir, 'fixtures', 'documents');
    const target = join(dataDir, 'fixtures', 'product');
    const missing = join(dataDir, 'fixtures', 'archive');
    const now = Date.now();
    for (const [path, name, lastOpenedAt] of [
      [workspace, '工作资料', now],
      [target, '产品设计', now - 2 * 60 * 60 * 1000],
      [missing, '归档项目', now - 24 * 60 * 60 * 1000],
    ] as const) {
      const id = createHash('sha1').update(path).digest('hex').slice(0, 12);
      const root = join(dataDir, 'workspaces', id);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, 'workspace.json'),
        JSON.stringify({ path, name, createdAt: lastOpenedAt, lastOpenedAt }),
      );
      if (path !== missing) mkdirSync(path, { recursive: true });
    }
    writeFileSync(join(target, '产品说明.md'), '# 产品说明\n');
    const fixture = await launchApp(dataDir);
    try {
      await use({ ...fixture, workspace, target, missing });
    } finally {
      await closeApp(fixture);
    }
  },
});

test('欢迎页列出已有工作区并通过点击切换', async ({ studio }, testInfo) => {
  const shell = await shellWindow(studio.app);
  // 这里只替换原生选择器；欢迎页按钮、列表和工作区切换走真实路径。
  await studio.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: true,
      filePaths: [],
    })) as typeof dialog.showOpenDialog;
  });
  await shell.getByTitle('新增', { exact: true }).click();
  const page = await windowByUrl(studio.app, /settings\/welcome\/index\.html/);
  const trigger = page.getByRole('button', { name: '切换工作区' });
  await expect(page.locator('#workspace-name')).toHaveText('工作资料');
  await trigger.click();
  const panel = page.getByRole('dialog', { name: '选择工作区' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /工作资料/ })).toBeDisabled();
  await expect(panel.getByRole('button', { name: /归档项目/ })).toBeDisabled();
  await expect(panel).toContainText('目录不存在');
  await expect(panel).not.toContainText(studio.dataDir);
  await expect(panel.getByRole('button', { name: /产品设计/ })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('workspace-picker.png') });
  await panel.getByRole('button', { name: /产品设计/ }).click();
  await expect.poll(() => currentPath(shell)).toBe(studio.target);
  await expect(shell.getByTestId('workspace-select')).toContainText('product');
  await expect(
    shell.getByTestId('sidebar-group').filter({ hasText: '本地文档' }),
  ).toBeVisible();
  await shell.getByTitle('新增', { exact: true }).click();
  const next = await windowByUrl(studio.app, /settings\/welcome\/index\.html/);
  await expect(next.locator('#workspace-name')).toHaveText('产品设计');
});

test('工作区面板支持关闭、目录变化刷新与窄布局', async ({
  studio,
}, testInfo) => {
  const shell = await shellWindow(studio.app);
  await shell.getByTitle('新增', { exact: true }).click();
  const page = await windowByUrl(studio.app, /settings\/welcome\/index\.html/);
  const trigger = page.getByRole('button', { name: '切换工作区' });
  const panel = page.getByRole('dialog', { name: '选择工作区' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /产品设计/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('heading', { name: '欢迎使用 WorkStudio' }).click();
  await expect(panel).toBeHidden();
  rmSync(studio.target, { recursive: true });
  await trigger.click();
  await expect(panel.getByRole('button', { name: /产品设计/ })).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: testInfo.outputPath('workspace-picker-narrow.png'),
  });
});

test('打开其他目录支持取消、失败提示和成功切换', async ({ studio }) => {
  const shell = await shellWindow(studio.app);
  await shell.getByTitle('新增', { exact: true }).click();
  const page = await windowByUrl(studio.app, /settings\/welcome\/index\.html/);
  await page.getByRole('button', { name: '切换工作区' }).click();
  const pick = page.getByRole('button', { name: '打开其他目录…' });
  await studio.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: true,
      filePaths: [],
    })) as typeof dialog.showOpenDialog;
  });
  await pick.click();
  await expect(pick).toBeEnabled();
  expect(await currentPath(shell)).toBe(studio.workspace);
  await studio.app.evaluate(({ dialog }, missing) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [missing],
    })) as typeof dialog.showOpenDialog;
  }, studio.missing);
  await pick.click();
  await expect(page.getByRole('status')).toContainText('工作区目录不存在');
  await expect(pick).toBeEnabled();
  expect(await currentPath(shell)).toBe(studio.workspace);
  await studio.app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [target],
    })) as typeof dialog.showOpenDialog;
  }, studio.target);
  await pick.click();
  await expect.poll(() => currentPath(shell)).toBe(studio.target);
});
