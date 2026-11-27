/**
 * Electron 进程入口（目标架构）。
 *
 * 只负责进程边界：单实例、scheme、数据根、session、remote debugging。
 * 业务模块由 NextApp / composition 装配；App 不直接认识具体模块。
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app as electronApp, BrowserWindow, dialog, session } from 'electron';
import { NextApp } from './app.ts';
import {
  dataRootPointerFile,
  resolveDataRoot,
  type DataRootInfo,
} from './platform/data-root.ts';
import { createStorageLayout } from './platform/paths.ts';
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

  // 开发档与安装包必须是两个 profile：否则 dev 会话的插件、设置与工作区
  // 会落进正式数据根，单实例锁也会互相挡。userData 必须在抢锁前定下来，
  // 锁是按 userData 划分的。
  // 显式 `--user-data-dir`（Playwright、隔离调试）优先：那是调用方自己的
  // profile，测试进程之间不能互相抢锁。
  const explicitProfile = electronApp.commandLine.hasSwitch('user-data-dir');
  const profileDir = explicitProfile
    ? electronApp.getPath('userData')
    : join(
        electronApp.getPath('appData'),
        options.devBase
          ? `${electronApp.getName()} Dev`
          : electronApp.getName(),
      );
  electronApp.setPath('userData', profileDir);

  if (!electronApp.requestSingleInstanceLock()) {
    electronApp.quit();
    return null;
  }
  const dataRoot = resolveDataRoot({
    pointerFile: dataRootPointerFile(profileDir),
    defaultRoot: join(profileDir, 'data'),
    portableRoot: join(dirname(electronApp.getPath('exe')), 'data'),
  });
  mkdirSync(dataRoot.root, { recursive: true });
  // Chromium 数据与业务数据分家，避免缓存混入数据根。
  electronApp.setPath('sessionData', join(profileDir, 'chromium'));

  await electronApp.whenReady();

  const storage = createStorageLayout(dataRoot.root);
  // 安装包首次启动没有工作区：先弹原生目录面板（同时完成目录授权），
  // 不能像开发 / 测试那样把 cwd（安装包启动时是 `/`）当工作区。
  const firstRunPicker = electronApp.isPackaged ? pickWorkspace : undefined;
  const app = new NextApp({
    dataRoot: storage.dataRoot,
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
