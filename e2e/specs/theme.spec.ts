import { expect, test } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from '../support/fixtures';

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
  await shell.getByTitle('切换为亮色').click();
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
  } finally {
    await closeApp(second);
  }
});
