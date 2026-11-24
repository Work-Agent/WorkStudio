/**
 * Electron 进程入口（目标架构）。
 *
 * 只负责进程边界：单实例、scheme、数据根、session、remote debugging。
 * 业务模块由 NextApp / composition 装配；App 不直接认识具体模块。
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app as electronApp, BrowserWindow, session } from 'electron';
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
  builtinSkillsRoot?: string;
}

export interface BootstrapResult {
  app: NextApp;
  dataRoot: DataRootInfo;
}

export async function bootstrapNext(
  options: BootstrapOptions = {},
): Promise<BootstrapResult | null> {
  registerSchemes();
  applyRemoteDebugging(options.debugPort);

  if (!electronApp.requestSingleInstanceLock()) {
    electronApp.quit();
    return null;
  }

  const profileDir = join(
    electronApp.getPath('appData'),
    electronApp.getName(),
  );
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
  const app = new NextApp({
    dataRoot: storage.dataRoot,
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    rendererRoot:
      options.rendererRoot ?? join(process.cwd(), 'out', 'renderer'),
    ...(options.devBase ? { devBase: options.devBase } : {}),
    ...(options.ipcLog === undefined ? {} : { ipcLog: options.ipcLog }),
    ...(options.shell ? { shell: options.shell } : {}),
    ...(options.builtinPluginsRoot
      ? { builtinPluginsRoot: options.builtinPluginsRoot }
      : {}),
    ...(options.builtinSkillsRoot
      ? { builtinSkillsRoot: options.builtinSkillsRoot }
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
