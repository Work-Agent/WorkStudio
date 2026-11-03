import { expect, test } from './app';
import { openSettings } from './commands';
import { windowByUrl } from './fixtures';

test('通过 views.open 打开内置插件设置页', async ({ shell, electron }) => {
  await openSettings(shell, 'plugins');
  const page = await windowByUrl(
    electron.app,
    /settings\/plugins\/index\.html/,
  );
  await expect(
    page.getByRole('heading', { name: 'WorkStudio 插件' }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof window.appBridge?.call))
    .toBe('function');
});
