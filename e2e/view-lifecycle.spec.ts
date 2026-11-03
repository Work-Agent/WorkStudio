import { expect, test } from './app';
import { closeView, openSettings, viewList } from './commands';
import { windowByUrl } from './fixtures';

test('打开并关闭设置视图', async ({ shell, electron }) => {
  await openSettings(shell, 'plugins');
  await windowByUrl(electron.app, /settings\/plugins\/index\.html/);

  const view = (await viewList(shell)).find((item) => item.title === '插件');
  expect(view).toBeTruthy();
  if (view) await closeView(shell, view.id);

  await expect
    .poll(
      () =>
        electron.app
          .windows()
          .filter((page) => /settings\/plugins\/index\.html/.test(page.url()))
          .length,
    )
    .toBe(0);
});
