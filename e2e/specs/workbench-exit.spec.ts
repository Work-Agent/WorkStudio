import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchApp,
  closeApp,
  shellWindow,
  windowByUrl,
} from '../support/fixtures';
import {
  switchWorkspace,
  openResource,
  currentPath,
} from '../support/commands';
import { fileRef } from '../../src/shared/ura';

test('工作区切换、关窗和退出都保护草稿；保存退出写回后才结束进程', async () => {
  const fixture = await launchApp();
  try {
    const shell = await shellWindow(fixture.app);
    const root = join(fixture.dataDir, 'fixtures', 'exit');
    const next = join(fixture.dataDir, 'fixtures', 'next');
    mkdirSync(root, { recursive: true });
    mkdirSync(next, { recursive: true });
    const file = join(root, 'note.txt');
    writeFileSync(file, 'before');
    await switchWorkspace(shell, root);
    await openResource(shell, fileRef(file));
    const page = await windowByUrl(fixture.app, /text-editor\/index\.html/);
    await page.locator('#editor').fill('draft to save');
    const overlay = await windowByUrl(fixture.app, /overlay\.html/);
    const switching = shell.evaluate(
      (path) => window.appBridge!.call('/workspaces/open', { path }),
      next,
    );
    await overlay.getByRole('button', { name: '取消', exact: true }).click();
    await switching;
    expect(await currentPath(shell)).toBe(root);
    await expect(page.locator('#editor')).toHaveValue('draft to save');
    await fixture.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await overlay.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('#editor')).toHaveValue('draft to save');
    await fixture.app.evaluate(({ app }) => {
      app.quit();
    });
    await overlay.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('#editor')).toHaveValue('draft to save');
    expect(readFileSync(file, 'utf8')).toBe('before');
    const closed = fixture.app.waitForEvent('close');
    await fixture.app.evaluate(({ app }) => {
      app.quit();
    });
    await overlay
      .getByRole('button', { name: '保存并继续', exact: true })
      .click();
    await closed;
    expect(readFileSync(file, 'utf8')).toBe('draft to save');
  } finally {
    await closeApp(fixture, true, true);
  }
});
