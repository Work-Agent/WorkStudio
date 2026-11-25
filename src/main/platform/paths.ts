/**
 * 数据根下的固定路径视图。
 *
 * 运行期只有一组写路径：内置插件与外部插件都落到 plugins/installed，
 * 插件数据在 plugins/data，目录缓存在 plugins/catalog，用户/内置技能在 skills。
 * 没有 appRoot 扫描根，也没有安装索引。
 */

import { join, resolve } from 'node:path';

export const PLUGINS_DIR = 'plugins';
export const INSTALLED_DIR = 'installed';
export const PLUGIN_DATA_DIR = 'data';
/** 插件临时区：与 data 同级，卸载时一起清理。 */
export const PLUGIN_TMP_DIR = 'tmp';
export const STAGING_DIR = 'staging';
export const RECOVERY_DIR = 'recovery';
export const CATALOG_DIR = 'catalog';
export const SKILLS_DIR = 'skills';
export const WORKSPACES_DIR = 'workspaces';
export const WEB_CACHE_DIR = 'web-cache';

export interface StorageLayout {
  readonly dataRoot: string;
  readonly workspacesRoot: string;
  readonly pluginsRoot: string;
  readonly pluginsInstalledRoot: string;
  readonly pluginsDataRoot: string;
  readonly pluginsTmpRoot: string;
  readonly pluginsStagingRoot: string;
  readonly pluginsRecoveryRoot: string;
  readonly pluginsCatalogRoot: string;
  readonly skillsRoot: string;
  readonly userSettingsFile: string;
  readonly windowsFile: string;
  readonly uiStateFile: string;
  readonly webCacheRoot: string;
  workspaceBase(workspaceId: string): string;
  workspaceSettingsFile(workspaceId: string): string;
  sessionsDir(workspaceId: string): string;
  sitesDir(workspaceId: string): string;
}

export function createStorageLayout(dataRoot: string): StorageLayout {
  const root = resolve(dataRoot);
  const workspacesRoot = join(root, WORKSPACES_DIR);
  const pluginsRoot = join(root, PLUGINS_DIR);
  return {
    dataRoot: root,
    workspacesRoot,
    pluginsRoot,
    pluginsInstalledRoot: join(pluginsRoot, INSTALLED_DIR),
    pluginsDataRoot: join(pluginsRoot, PLUGIN_DATA_DIR),
    pluginsTmpRoot: join(pluginsRoot, PLUGIN_TMP_DIR),
    pluginsStagingRoot: join(pluginsRoot, STAGING_DIR),
    pluginsRecoveryRoot: join(pluginsRoot, RECOVERY_DIR),
    pluginsCatalogRoot: join(pluginsRoot, CATALOG_DIR),
    skillsRoot: join(root, SKILLS_DIR),
    userSettingsFile: join(root, 'settings.json'),
    windowsFile: join(root, 'windows.json'),
    uiStateFile: join(root, 'ui-state.json'),
    webCacheRoot: join(root, WEB_CACHE_DIR),
    workspaceBase: (workspaceId) => join(workspacesRoot, workspaceId),
    workspaceSettingsFile: (workspaceId) =>
      join(workspacesRoot, workspaceId, 'settings.json'),
    sessionsDir: (workspaceId) => join(workspacesRoot, workspaceId, 'sessions'),
    sitesDir: (workspaceId) => join(workspacesRoot, workspaceId, 'sites'),
  };
}
