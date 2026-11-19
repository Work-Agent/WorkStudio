import { Menu } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import type { WindowManager } from './native.ts';

export function installMenu(windows: WindowManager): void {
  const isMac = process.platform === 'darwin';
  const active = (): WebContents | null =>
    windows.active()?.current()?.webContents ?? null;
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: '重载当前视图',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const wc = active();
            if (wc && !wc.isDestroyed()) wc.reload();
          },
        },
        {
          label: '开发者工具',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            const wc = active();
            if (!wc || wc.isDestroyed()) return;
            if (wc.isDevToolsOpened()) wc.closeDevTools();
            else wc.openDevTools({ mode: 'right' });
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
