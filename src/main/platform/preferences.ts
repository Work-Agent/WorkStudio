/**
 * 应用级偏好与工作区策略。
 *
 * 两者都寄存在 settings.json 的 workspaceStudio 命名空间：
 * 用户偏好写数据根，工作区策略写 workspaces/<id>/settings.json。
 */

import {
  writeNamespace,
  readNamespace,
  readJson,
  writeJson,
  isRecord,
} from './json.ts';
import type { StorageLayout } from './paths.ts';

export const SETTINGS_NAMESPACE = 'workspaceStudio';

/** 更新包来源：GitHub Releases 或腾讯云 COS 镜像。 */
export type UpdateSource = 'github' | 'cos';

export interface UserPreferences {
  locale: string | null;
  proxy: string | null;
  updateSource: UpdateSource;
}

export function readUserPreferences(layout: StorageLayout): UserPreferences {
  const raw = readNamespace(layout.userSettingsFile, SETTINGS_NAMESPACE);
  return {
    locale: typeof raw['locale'] === 'string' ? raw['locale'] : null,
    proxy:
      typeof raw['proxy'] === 'string' && raw['proxy'].trim()
        ? raw['proxy'].trim()
        : null,
    updateSource: raw['updateSource'] === 'cos' ? 'cos' : 'github',
  };
}

/** 仓库转公开后，清掉旧版本曾写入的 GitHub 访问令牌。 */
export function clearLegacyGithubToken(layout: StorageLayout): void {
  const file = layout.userSettingsFile;
  const document = readJson(file);
  const namespace = document[SETTINGS_NAMESPACE];
  if (!isRecord(namespace) || !('githubToken' in namespace)) return;
  delete namespace.githubToken;
  writeJson(file, document);
}

export function writeUserPreferences(
  layout: StorageLayout,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const next = { ...readUserPreferences(layout), ...patch };
  writeNamespace(layout.userSettingsFile, SETTINGS_NAMESPACE, { ...next });
  return next;
}
