import { expect, test } from '../support/app';

test('主窗口启动并加载壳层', async ({ shell }) => {
  await expect(shell).toHaveURL(/index\.html/);
  await expect(shell.getByRole('button', { name: 'WorkStudio' })).toBeVisible();
  await expect(shell.getByTestId('sidebar-nav-resources')).toBeVisible();
  await expect(shell.getByTestId('sidebar-nav-plugins')).toBeVisible();
  await expect(shell.getByTestId('sidebar-nav-settings')).toBeVisible();
});
