import { expect, test } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from './fixtures';

test('同一数据根重启后仍能加载壳层', async () => {
  const first = await launchApp();
  const dataDir = first.dataDir;
  await shellWindow(first.app);
  await closeApp(first, false);

  const second = await launchApp(dataDir);
  try {
    const window = await shellWindow(second.app);
    await expect(
      window.getByRole('button', { name: 'WorkStudio' }),
    ).toBeVisible();
  } finally {
    await closeApp(second);
  }
});
