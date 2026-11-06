import { expect, test } from '@playwright/test';
import {
  closeApp,
  launchApp,
  shellWindow,
  windowByUrl,
} from '../support/fixtures';

test('主题切换并在重启后保留', async () => {
  const first = await launchApp();
  await expect
    .poll(() =>
      shellWindow(first.app).then((page) =>
        page.evaluate(() =>
          document.documentElement.classList.contains('dark'),
        ),
      ),
    )
    .toBe(true);

  const shell = await shellWindow(first.app);
  await shell.evaluate(() =>
    window.appBridge!.call('/settings/open', { pageId: 'appearance' }),
  );
  const appearance = await windowByUrl(
    first.app,
    /settings\/appearance\/index\.html/,
  );
  await appearance.getByRole('button', { name: '使用雾蓝皮肤' }).click();
  await expect
    .poll(() =>
      shell.evaluate(() => document.documentElement.classList.contains('dark')),
    )
    .toBe(false);
  await closeApp(first, false);

  const second = await launchApp(first.dataDir);
  try {
    const page = await shellWindow(second.app);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains('dark'),
        ),
      )
      .toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--biz-bg')
            .trim(),
        ),
      )
      .toBe('#f4f8fc');
  } finally {
    await closeApp(second);
  }
});
