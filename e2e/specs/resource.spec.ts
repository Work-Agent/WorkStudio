import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../support/app';
import { switchWorkspace } from '../support/commands';
import { windowByUrl } from '../support/fixtures';

test('打开工作区内的 Markdown 资源页', async ({ shell, electron, dataDir }) => {
  const workspace = join(dataDir, 'fixtures', 'resource-workspace');
  mkdirSync(workspace, { recursive: true });
  const file = join(workspace, 'note.md');
  writeFileSync(file, '# hello\n\nbody\n', 'utf-8');

  await switchWorkspace(shell, workspace);
  await expect(shell.getByTestId('workspace-select')).toContainText(
    'resource-workspace',
  );
  // 走真实侧栏点击，而不是直接调用 commands/cmd。
  await shell
    .getByTestId('sidebar-group')
    .filter({ hasText: '本地文档' })
    .click();
  await shell.getByText('note.md', { exact: true }).click();

  const page = await windowByUrl(electron.app, /markdown-viewer\/index\.html/);
  await expect(page.getByRole('heading', { name: 'hello' })).toBeVisible();
  await expect(page.getByText('body')).toBeVisible();
});

test('没有查看器的资源不打开视图，只给通知条', async ({
  shell,
  electron,
  dataDir,
}) => {
  const workspace = join(dataDir, 'fixtures', 'no-viewer-workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'report.docx'), 'PK\u0003\u0004', 'utf-8');

  await switchWorkspace(shell, workspace);
  await expect(shell.getByTestId('workspace-select')).toContainText(
    'no-viewer-workspace',
  );
  // 上一个用例可能停在二级列表：先回主列表再走分组。
  const back = shell.getByTestId('sidebar-back');
  if (await back.isVisible().catch(() => false)) await back.click();
  await shell
    .getByTestId('sidebar-group')
    .filter({ hasText: '本地文档' })
    .click();
  await shell.getByText('report.docx', { exact: true }).click();

  await expect(shell.getByText(/无可用查看器：.*report\.docx/)).toBeVisible();
  expect(
    electron.app.windows().filter((page) => page.url().startsWith('app://')),
  ).toHaveLength(0);
});

test('侧栏查找按文件名匹配工作区资源', async ({ shell }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'wa-find-'));
  writeFileSync(join(workspace, 'search-target.md'), '# find\n', 'utf-8');
  await switchWorkspace(shell, workspace);

  const input = shell.getByTestId('sidebar-find-input');
  if (!(await input.isVisible().catch(() => false))) {
    await shell.getByTestId('sidebar-nav-find').click();
  }
  await input.fill('search-target');
  await expect(
    shell
      .getByTestId('sidebar-find-item')
      .filter({ hasText: 'search-target.md' }),
  ).toBeVisible();
});

test('重复打开同一资源复用同一视图', async ({ shell }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'wa-resource-reuse-'));
  const file = join(workspace, 'reuse.md');
  writeFileSync(file, '# reuse\n', 'utf-8');
  await switchWorkspace(shell, workspace);

  const result = await shell.evaluate(async (ref) => {
    const current = await window.appBridge!.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!current) throw new Error('workspace not ready');
    const open = async (): Promise<{ pageId: string; viewId: string }> => {
      const response = await window.appBridge!.call<{
        pageId: string;
        viewId: string;
      }>(`/workspaces/${current.id}/resources/pages/open`, { ref });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    };
    const first = await open();
    const second = await open();
    const views =
      (await window.appBridge!.peek<
        Array<{ id: string; contentPath: string | null }>
      >('/views')) ?? [];
    return { first, second, views };
  }, `file://${file}`);

  expect(result.first.pageId).toBe(result.second.pageId);
  expect(result.first.viewId).toBe(result.second.viewId);
  expect(
    result.views.filter((view) =>
      view.contentPath?.includes('/resources/pages/'),
    ),
  ).toHaveLength(1);
});
