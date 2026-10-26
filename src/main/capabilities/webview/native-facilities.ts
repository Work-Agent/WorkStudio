/**
 * 原生设施（architecture.md §5.1.6）—— shell 能力与原生菜单。
 *
 * 通道：ws:shell（invoke）——命令目录：shell.openPath / shell.openExternal /
 * shell.pickDirectory / popup.show；Menu.popup 选中经 ws:popup:select 回执发起窗口。
 */
import {
  dialog,
  ipcMain,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import {
  CH_POPUP_SELECT,
  CH_SHELL,
  CH_LEGACY_SHELL_OPEN_PATH,
} from '../../../shared/channels';
import type { PopupMenuItem } from '../../../shared/types';
import { createLogger } from '../../log';

const log = createLogger('native');

interface PopupShowInput {
  /** 调用方标识（菜单来源路由，如 'tabs'）。 */
  source: string;
  items: PopupMenuItem[];
}

export class NativeFacilities {
  private menu: Menu | null = null;
  private parent: BrowserWindow | null = null;
  /** 发起 popup.show 的页面（回执必须送回它，而不是主窗口）。 */
  private sender: WebContents | null = null;
  private open = false;

  registerShellIpc(getWindow: () => BrowserWindow | null): void {
    ipcMain.handle(CH_SHELL, (event, command: string, payload?: unknown) => {
      switch (command) {
        case 'openPath':
          return shell.openPath(
            String((payload as { path?: string })?.path ?? ''),
          );
        case 'openExternal':
          return shell.openExternal(
            String((payload as { url?: string })?.url ?? ''),
          );
        case 'pickDirectory': {
          const win = getWindow();
          return dialog
            .showOpenDialog(win ?? (undefined as never), {
              properties: ['openDirectory'],
            })
            .then((r) => (r.canceled ? null : (r.filePaths[0] ?? null)));
        }
        case 'popup.show':
          this.show(getWindow(), payload as PopupShowInput, event.sender);
          return true;
        case 'popup.close':
          this.close();
          return true;
        case 'popup.count':
          return this.open ? 1 : 0;
        default:
          throw new Error(`Unknown shell command: ${command}`);
      }
    });
    // 过渡期：旧渲染层的 openPath 通道（新代码一律走 ws:shell）。
    ipcMain.handle(CH_LEGACY_SHELL_OPEN_PATH, (_e, path: string) =>
      shell.openPath(path),
    );
  }

  private show(
    parent: BrowserWindow | null,
    input: PopupShowInput,
    sender: WebContents,
  ): void {
    if (!parent || parent.isDestroyed() || !input?.items?.length) return;
    this.close();
    this.parent = parent;
    this.sender = sender;
    this.open = true;
    const template: MenuItemConstructorOptions[] = input.items.map((item) => ({
      label: item.label,
      enabled: !item.disabled,
      click: () => {
        const target =
          this.sender && !this.sender.isDestroyed()
            ? this.sender
            : parent.webContents;
        if (!target.isDestroyed()) {
          target.send(CH_POPUP_SELECT, {
            source: input.source,
            actionId: item.id,
          });
        }
      },
    }));
    this.menu = Menu.buildFromTemplate(template);
    // 不传 x/y：默认鼠标位置弹出（右键语义）；Esc / 外点关闭 / 键盘导航原生免费。
    this.menu.popup({
      window: parent,
      callback: () => {
        this.open = false;
        this.menu = null;
        this.parent = null;
        this.sender = null;
      },
    });
    void log;
  }

  private close(): void {
    const menu = this.menu;
    const parent = this.parent;
    this.menu = null;
    this.parent = null;
    this.sender = null;
    this.open = false;
    if (menu && parent && !parent.isDestroyed()) {
      try {
        menu.closePopup(parent);
      } catch {
        /* 菜单已随窗口关闭 */
      }
    }
  }
}
