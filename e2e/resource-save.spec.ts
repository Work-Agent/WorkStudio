import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './app';
import { openResource, switchWorkspace } from './commands';
import { fileRef } from '../src/shared/ura';
import { windowByUrl } from './fixtures';

test('编辑资源并按 Ctrl+S 保存回磁盘', async ({ shell, electron, dataDir }) => {
  const workspace = join(dataDir, 'fixtures', 'save-workspace');
  mkdirSync(workspace, { recursive: true });
  const file = join(workspace, 'note.txt');
  writeFileSync(file, 'before\n', 'utf-8');

  await switchWorkspace(shell, workspace);
  await expect(shell.getByTestId('workspace-select')).toContainText(
    'save-workspace',
  );
  await openResource(shell, fileRef(file));

  const page = await windowByUrl(electron.app, /text-editor\/index\.html/);
  const editor = page.locator('#editor');
  await expect(editor).toHaveValue('before\n');
  await editor.fill('after\n');
  await page.keyboard.press('Control+S');
  await expect(page.locator('#toast')).toHaveText('已保存');
  expect(readFileSync(file, 'utf-8')).toBe('after\n');
});
