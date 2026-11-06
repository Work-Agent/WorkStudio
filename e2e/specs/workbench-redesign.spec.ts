import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../support/app';
import {
  openResource,
  openSettings,
  switchWorkspace,
  viewList,
} from '../support/commands';
import { windowByUrl } from '../support/fixtures';
import { fileRef } from '../../src/shared/ura';

const fixtureFile = (
  dataDir: string,
  name: string,
): { root: string; file: string } => {
  const root = join(dataDir, 'fixtures', name);
  mkdirSync(root, { recursive: true });
  const file = join(root, 'note.txt');
  writeFileSync(file, 'before\n');
  return { root, file };
};

test('四套皮肤同步到独立页面，设置导航复用标签并保留资料栏', async ({
  shell,
  electron,
  dataDir,
}) => {
  const { root } = fixtureFile(dataDir, 'appearance-workspace');
  await switchWorkspace(shell, root);
  await openSettings(shell, 'appearance');
  const page = await windowByUrl(
    electron.app,
    /settings\/appearance\/index\.html/,
  );
  for (const [name, bg] of [
    ['曜黑', '#000000'],
    ['石墨', '#22252b'],
    ['白瓷', '#ffffff'],
    ['雾蓝', '#f4f8fc'],
  ]) {
    await page.getByRole('button', { name: `使用${name}皮肤` }).click();
    await expect
      .poll(() =>
        shell.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--biz-bg')
            .trim(),
        ),
      )
      .toBe(bg);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--bg')
            .trim(),
        ),
      )
      .toBe(bg);
  }
  await page.getByLabel('编辑器字号', { exact: true }).selectOption('18');
  const before = (await viewList(shell)).length;
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '模型连接', exact: true })
    .click();
  const models = await windowByUrl(
    electron.app,
    /settings\/models\/index\.html/,
  );
  await expect(
    models.getByRole('heading', { name: '模型连接', exact: true }),
  ).toBeVisible();
  expect((await viewList(shell)).length).toBe(before);
  await expect(
    shell.getByRole('button', { name: 'note.txt', exact: false }),
  ).toBeVisible();
  const another = fixtureFile(dataDir, 'another-workspace');
  await switchWorkspace(shell, another.root);
  await expect
    .poll(() =>
      shell.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--biz-bg')
          .trim(),
      ),
    )
    .toBe('#f4f8fc');
});

test('关闭未保存文档可取消，保存并继续确实写回文件', async ({
  shell,
  electron,
  dataDir,
}) => {
  const { root, file } = fixtureFile(dataDir, 'draft-workspace');
  await switchWorkspace(shell, root);
  await openResource(shell, fileRef(file));
  const page = await windowByUrl(electron.app, /text-editor\/index\.html/);
  await expect(
    shell.getByTestId('resource-item').filter({ hasText: 'note.txt' }),
  ).toHaveClass(/is-active/);
  await page.locator('#editor').fill('edited\n');
  await expect(page.getByRole('status')).toContainText('未保存');
  await shell
    .getByTestId('doc-tabs')
    .getByTitle('关闭', { exact: true })
    .click();
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  await expect(overlay.getByRole('dialog')).toContainText('未保存');
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#editor')).toHaveValue('edited\n');
  expect(readFileSync(file, 'utf8')).toBe('before\n');
  await shell
    .getByTestId('doc-tabs')
    .getByTitle('关闭', { exact: true })
    .click();
  await overlay
    .getByRole('button', { name: '保存并继续', exact: true })
    .click();
  await expect.poll(async () => (await viewList(shell)).length).toBe(0);
  expect(readFileSync(file, 'utf8')).toBe('edited\n');
});

test('外部修改不覆盖草稿，保存冲突后可另存副本并重新读取', async ({
  shell,
  electron,
  dataDir,
}) => {
  const { root, file } = fixtureFile(dataDir, 'conflict-workspace');
  await switchWorkspace(shell, root);
  await openResource(shell, fileRef(file));
  const page = await windowByUrl(electron.app, /text-editor\/index\.html/);
  await page.locator('#editor').fill('draft content\n');
  writeFileSync(file, 'external content\n');
  await expect
    .poll(async () =>
      (
        await shell.evaluate(() =>
          window.appBridge!.peek<Array<{ conflict: boolean }>>('/views'),
        )
      )?.some((v) => v.conflict),
    )
    .toBe(true);
  await expect(page.locator('#editor')).toHaveValue('draft content\n');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('外部修改');
  expect(readFileSync(file, 'utf8')).toBe('external content\n');
  const copy = join(root, 'note-copy.txt');
  await electron.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog;
  }, copy);
  await page.getByRole('button', { name: '另存副本', exact: true }).click();
  await expect
    .poll(() => {
      try {
        return readFileSync(copy, 'utf8');
      } catch {
        return '';
      }
    })
    .toBe('draft content\n');
  await expect(page.locator('#editor')).toHaveValue('draft content\n');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  await overlay.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('#editor')).toHaveValue('external content\n');
});

test('偏好设置按范围保存，离开模型页时保留未提交表单', async ({
  shell,
  electron,
  dataDir,
}) => {
  const { root } = fixtureFile(dataDir, 'settings-drafts');
  await switchWorkspace(shell, root);
  await openSettings(shell, 'preferences');
  let page = await windowByUrl(
    electron.app,
    /settings\/preferences\/index\.html/,
  );
  await page.locator('[id="project-retry.maxRetries"]').fill('7');
  await page.locator('#settings-scope').selectOption('global');
  const overlay = await windowByUrl(electron.app, /overlay\.html/);
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#settings-scope')).toHaveValue('project');
  await expect(page.locator('[id="project-retry.maxRetries"]')).toHaveValue(
    '7',
  );
  await page.locator('#settings-scope').selectOption('global');
  await overlay
    .getByRole('button', { name: '保存并切换', exact: true })
    .click();
  await expect(page.locator('#settings-scope')).toHaveValue('global');
  await expect
    .poll(() =>
      shell.evaluate(
        async () =>
          (
            await window.appBridge!.peek<{
              settings: { project: { retry: { maxRetries: number } } };
            }>('/piconf')
          )?.settings.project.retry.maxRetries,
      ),
    )
    .toBe(7);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '模型连接', exact: true })
    .click();
  page = await windowByUrl(electron.app, /settings\/models\/index\.html/);
  await page.locator('summary').filter({ hasText: '自定义服务连接' }).click();
  await page.locator('#new-id').fill('draft-provider');
  await page.locator('#new-base').fill('http://127.0.0.1:12345/v1');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '外观与皮肤', exact: true })
    .click();
  await overlay.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#new-id')).toHaveValue('draft-provider');
  await expect(page.locator('#new-base')).toHaveValue(
    'http://127.0.0.1:12345/v1',
  );
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '外观与皮肤', exact: true })
    .click();
  await overlay.getByRole('button', { name: '放弃修改', exact: true }).click();
  await windowByUrl(electron.app, /settings\/appearance\/index\.html/);
});

test('技能工作区启用状态独立并持久保存，不混成本轮选择', async ({
  shell,
  electron,
  dataDir,
}) => {
  const first = fixtureFile(dataDir, 'skill-scope-first');
  const second = fixtureFile(dataDir, 'skill-scope-second');
  await switchWorkspace(shell, first.root);
  await openSettings(shell, 'skills');
  const page = await windowByUrl(electron.app, /settings\/skills\/index\.html/);
  const skill = await shell.evaluate(async () => {
    const state = await window.appBridge!.peek<{
      skills: Array<{ name: string }>;
    }>('/piconf');
    return state?.skills[0]?.name;
  });
  expect(skill).toBeTruthy();
  const enabled = () =>
    shell.evaluate(async (name) => {
      const state = await window.appBridge!.peek<{
        skills: Array<{ name: string; enabled: boolean }>;
      }>('/piconf');
      return state?.skills.find((item) => item.name === name)?.enabled;
    }, skill);
  await page.locator(`[data-toggle-skill="${skill}"]`).click();
  await expect.poll(enabled).toBe(false);
  await expect(page.locator('body')).toContainText('本工作区已停用');
  await switchWorkspace(shell, second.root);
  await expect.poll(enabled).toBe(true);
  await switchWorkspace(shell, first.root);
  await expect.poll(enabled).toBe(false);
});
