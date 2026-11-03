import { expect, test } from './app';

test('侧栏在资源 / 插件 / 设置之间切换', async ({ shell }) => {
  await shell.getByTestId('sidebar-nav-plugins').click();
  await expect(shell.getByTestId('sidebar-nav-plugins')).toHaveAttribute(
    'data-active',
    'true',
  );

  await shell.getByTestId('sidebar-nav-settings').click();
  await expect(shell.getByTestId('sidebar-nav-settings')).toHaveAttribute(
    'data-active',
    'true',
  );

  await shell.getByTestId('sidebar-nav-resources').click();
  await expect(shell.getByTestId('sidebar-nav-resources')).toHaveAttribute(
    'data-active',
    'true',
  );
});
