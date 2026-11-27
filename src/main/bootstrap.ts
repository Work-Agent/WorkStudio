/**
 * Electron 进程入口（目标架构）。
 *
 * 只负责进程边界：单实例、scheme、数据根、session、remote debugging。
 * 业务模块由 NextApp / composition 装配；App 不直接认识具体模块。
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  app as electronApp,
  BrowserWindow,
  dialog,
  nativeImage,
  session,
} from 'electron';
import { NextApp } from './app.ts';
import {
  dataRootPointerFile,
  resolveDataRoot,
  type DataRootInfo,
} from './platform/data-root.ts';
import { createStorageLayout } from './platform/paths.ts';
import { readAppFlavor, resolveProfile } from './platform/profile.ts';
import { registerSchemes, serveProtocols } from './protocols.ts';
import { installApplicationMenu } from './platform/menu.ts';
import type { ShellHostOptions } from './domains/shell/native.ts';

export interface BootstrapOptions {
  /** 默认工作区路径；缺省用当前进程目录。 */
  workspaceRoot?: string;
  /** 系统页产物目录；缺省 out/renderer。 */
  rendererRoot?: string;
  devBase?: string;
  debugPort?: string;
  ipcLog?: boolean;
  shell?: Omit<ShellHostOptions, 'origins'>;
  builtinPluginsRoot?: string;
}

export interface BootstrapResult {
  app: NextApp;
  dataRoot: DataRootInfo;
}

/** 首次启动选择工作区：原生面板就是 macOS 的目录授权入口。 */
async function pickWorkspace(): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    title: '选择工作区目录',
    buttonLabel: '打开',
    properties: ['openDirectory', 'createDirectory'],
  });
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

export async function bootstrapNext(
  options: BootstrapOptions = {},
): Promise<BootstrapResult | null> {
  registerSchemes();
  applyRemoteDebugging(options.debugPort);

  // 开发档与安装包必须是两个 profile：否则开发会话的插件、设置与工作区
  // 会落进正式数据根，单实例锁也会互相挡。userData 必须在抢锁前定下来，
  // 锁是按 userData 划分的。
  const profile = resolveProfile({
    appData: electronApp.getPath('appData'),
    appName: electronApp.getName(),
    isPackaged: electronApp.isPackaged,
    flavor: readAppFlavor(electronApp.getAppPath()),
    // 显式 `--user-data-dir`（Playwright、隔离调试）优先：那是调用方自己的
    // profile，测试进程之间不能互相抢锁。
    explicitDir: electronApp.commandLine.hasSwitch('user-data-dir')
      ? electronApp.getPath('userData')
      : null,
  });
  // 开发档先改名：菜单、关于面板、钥匙串条目都跟着它走，系统里也是两个应用。
  if (profile.dev) electronApp.setName(profile.name);
  mkdirSync(join(profile.dir, 'logs'), { recursive: true });
  electronApp.setPath('userData', profile.dir);
  // 日志跟档走，不落系统级的 `~/Library/Logs/<app>`。
  electronApp.setAppLogsPath(join(profile.dir, 'logs'));

  if (!electronApp.requestSingleInstanceLock()) {
    electronApp.quit();
    return null;
  }
  const dataRoot = resolveDataRoot({
    pointerFile: dataRootPointerFile(profile.dir),
    defaultRoot: join(profile.dir, 'data'),
    portableRoot: join(dirname(electronApp.getPath('exe')), 'data'),
  });
  mkdirSync(dataRoot.root, { recursive: true });
  // Chromium 数据与业务数据分家，避免缓存混入数据根。
  electronApp.setPath('sessionData', join(profile.dir, 'chromium'));

  await electronApp.whenReady();
  applyDevDockIcon();

  const storage = createStorageLayout(dataRoot.root);
  // 安装包首次启动没有工作区：先弹原生目录面板（同时完成目录授权），
  // 不能像开发 / 测试那样把 cwd（安装包启动时是 `/`）当工作区。
  const firstRunPicker = electronApp.isPackaged ? pickWorkspace : undefined;
  const app = new NextApp({
    dataRoot: storage.dataRoot,
    profileDir: profile.dir,
    ...(firstRunPicker
      ? { pickWorkspace: firstRunPicker }
      : { workspaceRoot: options.workspaceRoot ?? process.cwd() }),
    rendererRoot:
      options.rendererRoot ?? join(process.cwd(), 'out', 'renderer'),
    ...(options.devBase ? { devBase: options.devBase } : {}),
    ...(options.ipcLog === undefined ? {} : { ipcLog: options.ipcLog }),
    ...(options.shell ? { shell: options.shell } : {}),
    ...(options.builtinPluginsRoot
      ? { builtinPluginsRoot: options.builtinPluginsRoot }
      : {}),
  });

  serveProtocols(session.defaultSession, app.protocols);
  await app.start();
  installApplicationMenu(app.shellHost);

  electronApp.on('second-instance', focusWindow);
  electronApp.on('activate', focusWindow);
  electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') electronApp.quit();
  });
  electronApp.on('before-quit', () => {
    void app.stop();
  });

  return { app, dataRoot };
}

/**
 * 开发态没有应用包，Dock 会显示 Electron 默认图标；用设计稿生成的一档位图兜底。
 * 安装包的图标由 electron-builder 写进 bundle，这里只管源码运行。
 */
function applyDevDockIcon(): void {
  if (electronApp.isPackaged || process.platform !== 'darwin') return;
  const icon = join(electronApp.getAppPath(), 'build', 'icon.png');
  if (!existsSync(icon)) return;
  const image = nativeImage.createFromPath(icon);
  if (!image.isEmpty()) electronApp.dock?.setIcon(image);
}

function focusWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function applyRemoteDebugging(port: string | undefined): void {
  if (electronApp.commandLine.hasSwitch('remote-debugging-port')) return;
  const value = port ?? process.env['WA_DEBUG_PORT'];
  if (!value || !/^\d+$/.test(value)) return;
  electronApp.commandLine.appendSwitch('remote-debugging-port', value);
}
