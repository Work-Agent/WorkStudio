/** 应用菜单：编辑 / 视图 / 窗口；重载与开发者工具作用于当前内容视图。 */
import { Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { ShellHost } from '../domains/shell/native.ts';

export function installApplicationMenu(host: ShellHost | null): void {
  const isMac = process.platform === 'darwin';
  const target = (): ReturnType<ShellHost['activeContentWebContents']> =>
    host?.activeContentWebContents() ?? null;
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        {
          label: '重载当前视图',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const wc = target();
            if (wc && !wc.isDestroyed()) wc.reload();
          },
        },
        {
          label: '开发者工具',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            const wc = target();
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
