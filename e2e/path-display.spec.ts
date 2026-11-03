import { expect, test } from './app';
import { currentPath, openSettings } from './commands';
import { windowByUrl } from './fixtures';

test('页面展示路径相对 app / 工作区', async ({ electron, shell }) => {
  const workspace = await currentPath(shell);
  await openSettings(shell, 'plugins');
  const address = await shell.getByTestId('resource-url-bar').innerText();
  expect(address).toBe('settings://plugins');

  await openSettings(shell, 'storage');
  const page = await windowByUrl(
    electron.app,
    /settings\/storage\/index\.html/,
  );
  await expect.poll(() => page.locator('body').innerText()).toContain('app/');
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(workspace ?? '__no_workspace__');
});
