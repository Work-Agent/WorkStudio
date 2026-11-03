import { expect, test } from './app';
import { windowByUrl } from './fixtures';

test('助手视图加载并显示未配置状态', async ({ electron }) => {
  const assistant = await windowByUrl(electron.app, /assistant\.html/);
  await expect(assistant.locator('body')).toContainText('未配置模型');
  await expect
    .poll(() => assistant.evaluate(() => typeof window.appBridge?.call))
    .toBe('function');
});
