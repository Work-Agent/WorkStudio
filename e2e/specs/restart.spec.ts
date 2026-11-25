import { expect, test } from '@playwright/test';
import { closeApp, launchApp, shellWindow } from '../support/fixtures.ts';
import { currentPath } from '../support/commands.ts';

/**
 * Playwright 独享：同一数据根重启后恢复工作区与布局。
 * 不进入共享 case，dev runner 不执行。
 */
test('重启恢复工作区与布局场景', async () => {
  const first = await launchApp();
  const firstShell = await shellWindow(first.app);
  const workspace = await currentPath(firstShell);
  if (!workspace) throw new Error('首次启动没有工作区');
  await firstShell.evaluate(async () => {
    const windowId = window.workStudio.workspaceId;
    if (!windowId) throw new Error('窗口未绑定工作区');
    await window.workStudio.command('shell', `${windowId}/layout`, 'scene', {
      patch: { sidebarCollapsed: true, aiOpen: false },
    });
  });
  await closeApp(first, false, true);

  const second = await launchApp(first.dataDir);
  try {
    const shell = await shellWindow(second.app);
    await expect
      .poll(async () => {
        const registry = (await shell.evaluate(() =>
          window.workStudio.subscribe('workspace', 'registry'),
        )) as { current?: { path?: string } | null };
        return registry.current?.path ?? null;
      })
      .toBe(workspace);
    await expect
      .poll(async () =>
        shell.evaluate(
          () =>
            getComputedStyle(document.documentElement).getPropertyValue(
              '--wb-sidebar-w',
            ) === '56px',
        ),
      )
      .toBe(true);
  } finally {
    await closeApp(second, true, true);
  }
});
