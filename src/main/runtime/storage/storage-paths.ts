/**
 * 数据根派生出的只读路径视图。
 *
 * dataRoot 的解析仍在 bootstrap（它必须早于 App / Domain 启动）；
 * 运行时业务不再直接调用 getDataRoot()，而是依赖这个值对象。
 */

import path from 'node:path';

export interface StoragePaths {
  readonly dataRoot: string;
  readonly profileDir: string;
  readonly chromiumDir: string;
  readonly workspacesRoot: string;
  readonly pluginsRoot: string;
  readonly pluginDataRoot: string;
  readonly logsDir: string;
  readonly userSettingsFile: string;
  readonly uraBindingsFile: string;
  readonly windowsFile: string;
  workspaceBase(wsId: string): string;
  sessionsDir(wsId: string): string;
}

export function createStoragePaths(input: {
  dataRoot: string;
  profileDir: string;
}): StoragePaths {
  const dataRoot = path.resolve(input.dataRoot);
  const profileDir = path.resolve(input.profileDir);
  const workspacesRoot = path.join(dataRoot, 'workspaces');
  const pluginsRoot = path.join(dataRoot, 'plugins');
  return {
    dataRoot,
    profileDir,
    chromiumDir: path.join(profileDir, 'chromium'),
    workspacesRoot,
    pluginsRoot,
    pluginDataRoot: path.join(pluginsRoot, 'data'),
    logsDir: path.join(dataRoot, 'logs'),
    userSettingsFile: path.join(dataRoot, 'settings.json'),
    uraBindingsFile: path.join(dataRoot, 'ura-bindings.json'),
    windowsFile: path.join(dataRoot, 'windows.json'),
    workspaceBase: (wsId) => path.join(workspacesRoot, wsId),
    sessionsDir: (wsId) => path.join(workspacesRoot, wsId, 'sessions'),
  };
}
