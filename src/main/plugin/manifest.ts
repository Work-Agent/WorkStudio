/**
 * 插件静态声明：唯一事实源在 @work-studio/sdk。
 *
 * 宿主只保留支持版本常量与解析后的 PluginPackage（绝对路径）。
 */

import type { WorkStudioManifest } from '@work-studio/sdk';

export type { WorkStudioManifest } from '@work-studio/sdk';

/** 解析后的插件包：路径均为绝对路径。 */
/** 系统域保留的 id；插件不得占用，避免注册表冲突。 */
export const RESERVED_PLUGIN_IDS = new Set([
  'plugin',
  'shell',
  'settings',
  'workspace',
  'agent',
  'browser',
  'files',
  'web',
  'lists',
]);

export function isReservedPluginId(pluginId: string): boolean {
  return RESERVED_PLUGIN_IDS.has(pluginId);
}

export interface PluginPackage {
  manifest: WorkStudioManifest;
  /** package.json 的 version；清单字段只描述框架需要知道的身份。 */
  version: string;
  root: string;
  /** 动态入口：exports['./workstudio'] 指向的 ESM 文件。 */
  entry: string;
  contentPage: string;
  settingsPage?: string;
}
