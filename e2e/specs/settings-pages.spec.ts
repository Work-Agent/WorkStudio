import { expect, test } from '../support/app';
import { windowByUrl } from '../support/fixtures';

const PAGES = [
  'storage',
  'workspaces',
  'browser',
  'resources',
  'skills',
  'sessions',
  'preferences',
  'welcome',
  'extensions',
  'models',
] as const;

test('内置设置页全部可加载且无脚本错误', async ({ electron, shell }) => {
  test.setTimeout(60_000);
  for (const id of PAGES) {
    const opened = await shell.evaluate(
      async (pageId) => window.appBridge!.call('/settings/open', { pageId }),
      id,
    );
    expect(opened.ok, id).toBe(true);
    const page = await windowByUrl(
      electron.app,
      new RegExp(`settings/${id}/index\\.html`),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.waitForTimeout(250);
    expect(errors, id).toEqual([]);
  }
});
