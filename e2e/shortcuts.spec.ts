import { expect, test } from './app';
import { openSettings, viewList } from './commands';

test('Cmd/Ctrl+数字激活标签，Cmd/Ctrl+W 关闭激活标签', async ({
  shell,
  electron,
}) => {
  await openSettings(shell, 'plugins');
  await openSettings(shell, 'models');
  await expect
    .poll(async () => (await viewList(shell)).length)
    .toBeGreaterThanOrEqual(2);

  const before = (await viewList(shell)).length;
  await electron.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.webContents.focus();
    win.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: '1',
      modifiers: ['control'],
    });
    win.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: '1',
      modifiers: ['control'],
    });
    win.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'W',
      modifiers: ['control'],
    });
    win.webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'W',
      modifiers: ['control'],
    });
  });

  await expect
    .poll(async () => (await viewList(shell)).length)
    .toBe(before - 1);
});
