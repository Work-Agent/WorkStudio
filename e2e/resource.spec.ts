import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './app';
import { openResource, switchWorkspace } from './commands';
import { fileRef } from '../src/shared/ura';
import { windowByUrl } from './fixtures';

test('打开工作区内的 Markdown 资源页', async ({ shell, electron, dataDir }) => {
  const workspace = join(dataDir, 'fixtures', 'resource-workspace');
  mkdirSync(workspace, { recursive: true });
  const file = join(workspace, 'note.md');
  writeFileSync(file, '# hello\n\nbody\n', 'utf-8');

  await switchWorkspace(shell, workspace);
  await expect(shell.getByTestId('workspace-select')).toContainText(
    'resource-workspace',
  );
  await openResource(shell, fileRef(file));

  const page = await windowByUrl(electron.app, /markdown-viewer\/index\.html/);
  await expect(page.getByRole('heading', { name: 'hello' })).toBeVisible();
  await expect(page.getByText('body')).toBeVisible();
});
