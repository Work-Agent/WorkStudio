import { expect, test } from './app';
import { openSettings, viewList } from './commands';

test('标签栏显示多个视图并可激活标签', async ({ shell }) => {
  await openSettings(shell, 'plugins');
  await openSettings(shell, 'models');

  await expect
    .poll(async () => (await viewList(shell)).length)
    .toBeGreaterThanOrEqual(2);
  const tabs = shell.getByTestId('doc-tabs');
  await expect(tabs).toContainText('插件');
  await expect(tabs).toContainText('模型配置');

  await tabs.getByTitle('模型配置').click();
  await expect
    .poll(async () => {
      const views = await viewList(shell);
      return views.find((view) => view.active)?.title;
    })
    .toBe('模型配置');
});
