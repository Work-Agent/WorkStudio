import { mkdirSync, writeFileSync } from 'node:fs';
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
