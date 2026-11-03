import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { switchWorkspace } from '../support/commands';
import { closeApp, launchApp, shellWindow } from '../support/fixtures';

test('切换工作区并在重启后恢复', async () => {
  const first = await launchApp();
  const workspace = join(first.dataDir, 'fixtures', 'e2e-workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'note.md'), '# e2e\n', 'utf-8');

  try {
    const shell = await shellWindow(first.app);
    await switchWorkspace(shell, workspace);
    await expect(shell.getByTestId('workspace-select')).toContainText(
      'e2e-workspace',
    );
  } finally {
    await closeApp(first, false);
  }

  const second = await launchApp(first.dataDir);
  try {
    const shell = await shellWindow(second.app);
    await expect(shell.getByTestId('workspace-select')).toContainText(
      'e2e-workspace',
    );
  } finally {
    await closeApp(second);
  }
});
