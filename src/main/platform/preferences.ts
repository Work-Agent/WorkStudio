/**
 * 应用级偏好与工作区策略。
 *
 * 两者都寄存在 settings.json 的 workspaceStudio 命名空间：
 * 用户偏好写数据根，工作区策略写 workspaces/<id>/settings.json。
 */

import { writeNamespace, readNamespace, readJson, writeJson } from './json.ts';
import type { StorageLayout } from './paths.ts';

export const SETTINGS_NAMESPACE = 'workspaceStudio';

/** 更新包来源：GitHub Releases 或腾讯云 COS 镜像。 */
export type UpdateSource = 'github' | 'cos';

export interface UserPreferences {
  locale: string | null;
  proxy: string | null;
  githubToken: string | null;
  updateSource: UpdateSource;
}

export interface WorkspacePolicy {
  disabledSkills: string[];
  browser: { allowlist: string[] };
}

export function readUserPreferences(layout: StorageLayout): UserPreferences {
  const raw = readNamespace(layout.userSettingsFile, SETTINGS_NAMESPACE);
  return {
    locale: typeof raw['locale'] === 'string' ? raw['locale'] : null,
    proxy:
      typeof raw['proxy'] === 'string' && raw['proxy'].trim()
        ? raw['proxy'].trim()
        : null,
    githubToken:
      typeof raw['githubToken'] === 'string' && raw['githubToken'].trim()
        ? raw['githubToken'].trim()
        : null,
    updateSource: raw['updateSource'] === 'cos' ? 'cos' : 'github',
  };
}

export function writeUserPreferences(
  layout: StorageLayout,
  patch: Partial<UserPreferences>,
): UserPreferences {
  const next = { ...readUserPreferences(layout), ...patch };
  writeNamespace(layout.userSettingsFile, SETTINGS_NAMESPACE, { ...next });
  return next;
}

export function readWorkspacePolicy(
  layout: StorageLayout,
  workspaceId: string,
): WorkspacePolicy {
  const file = layout.workspaceSettingsFile(workspaceId);
  const raw = readNamespace(file, SETTINGS_NAMESPACE);
  const browser = raw['browser'];
  const allowlist =
    typeof browser === 'object' && browser !== null
      ? (browser as { allowlist?: unknown }).allowlist
      : undefined;
  return {
    disabledSkills: Array.isArray(raw['disabledSkills'])
      ? raw['disabledSkills'].filter(
          (name): name is string => typeof name === 'string',
        )
      : [],
    browser: {
      allowlist: Array.isArray(allowlist)
        ? allowlist.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    },
  };
}

export function writeWorkspacePolicy(
  layout: StorageLayout,
  workspaceId: string,
  patch: Partial<WorkspacePolicy> & { browser?: { allowlist?: string[] } },
): WorkspacePolicy {
  const current = readWorkspacePolicy(layout, workspaceId);
  const next: WorkspacePolicy = {
    disabledSkills: patch.disabledSkills ?? current.disabledSkills,
    browser: {
      allowlist: patch.browser?.allowlist ?? current.browser.allowlist,
    },
  };
  writeNamespace(
    layout.workspaceSettingsFile(workspaceId),
    SETTINGS_NAMESPACE,
    { ...next },
  );
  return next;
}

/** 设置页需要知道数据根与工作区文件位置；路径只在这里投影一次。 */
export function readSettingsDocument(file: string): Record<string, unknown> {
  return readJson(file);
}

export function writeSettingsDocument(
  file: string,
  value: Record<string, unknown>,
): void {
  writeJson(file, value);
}
