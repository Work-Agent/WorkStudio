import { expect, test } from './app';

/**
 * dev attach：连接 dev extension 维持的 CDP 窗口。
 * 只验证 attach 通道与壳层点击，不切工作区、不写文件。
 * 资源文件的真实点击由 resource.spec 在隔离数据根覆盖。
 */
test('dev attach：连接 dev 窗口并点击侧栏导航', async ({ shell, electron }) => {
  test.setTimeout(20_000);
  expect(electron.attached, '需以 E2E_ATTACH=1 运行').toBe(true);
  expect(shell.url()).toMatch(/\/index\.html$/);

  const workspace = await shell.evaluate(async () =>
    window.appBridge!.peek<{ id: string }>('/workspaces/current'),
  );
  expect(workspace?.id).toBeTruthy();

  await shell.getByTestId('sidebar-nav-resources').click();
  await expect(shell.getByTestId('sidebar-nav-resources')).toHaveAttribute(
    'data-active',
    'true',
  );

  await shell.getByTestId('sidebar-nav-settings').click();
  await expect(shell.getByTestId('sidebar-nav-settings')).toHaveAttribute(
    'data-active',
    'true',
  );
});
