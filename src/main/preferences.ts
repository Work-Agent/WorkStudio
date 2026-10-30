/**
 * 应用偏好与工作区策略（architecture.md §2.6）。
 *
 * 寄存在两个 pi 设置文件的同名命名空间 `workspaceStudio` 里：
 *   <data-root>/settings.json             用户级偏好（theme / locale）
 *   <workspaces/<wsId>/settings.json      工作区策略（浏览器白名单等）
 *
 * 读写都是**字段级合并**：只替换 `workspaceStudio` 整块，pi 的键与其他字段原样保留
 * （pi 的 SettingsManager 保存时同样只覆盖它改过的顶层字段）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getWorkspaceBase } from './agent/workspace';
import { rootPath } from './paths';

const NAMESPACE = 'workspaceStudio';

export interface UserPreferences {
  theme: 'light' | 'dark';
  locale: string | null;
}

export interface WorkspacePolicy {
  browser: { allowlist: string[] };
}

const DEFAULT_USER: UserPreferences = { theme: 'dark', locale: null };
const DEFAULT_POLICY: WorkspacePolicy = { browser: { allowlist: [] } };

/** 用户级设置文件（同时是 pi 的 global settings）。 */
function userSettingsFile(): string {
  return rootPath('settings.json');
}

/** 工作区设置文件（同时是 pi 的 project settings）。 */
function workspaceSettingsFile(wsId: string): string {
  return join(getWorkspaceBase(wsId), 'settings.json');
}

export function readUserPreferences(): UserPreferences {
  const raw = readNamespace(userSettingsFile());
  return {
    theme:
      raw['theme'] === 'light' || raw['theme'] === 'dark'
        ? raw['theme']
        : DEFAULT_USER.theme,
    locale: typeof raw['locale'] === 'string' ? raw['locale'] : null,
  };
}

export function writeUserPreferences(
  patch: Partial<UserPreferences>,
): UserPreferences {
  const next = { ...readUserPreferences(), ...patch };
  writeNamespace(userSettingsFile(), { ...next });
  return next;
}

export function readWorkspacePolicy(wsId: string): WorkspacePolicy {
  const raw = readNamespace(workspaceSettingsFile(wsId));
  const browser = raw['browser'];
  const allowlist =
    typeof browser === 'object' && browser !== null
      ? (browser as { allowlist?: unknown }).allowlist
      : undefined;
  return {
    browser: {
      allowlist: Array.isArray(allowlist)
        ? allowlist.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : DEFAULT_POLICY.browser.allowlist,
    },
  };
}

export function writeWorkspacePolicy(
  wsId: string,
  patch: { browser?: { allowlist?: string[] } },
): WorkspacePolicy {
  const current = readWorkspacePolicy(wsId);
  const next: WorkspacePolicy = {
    browser: { ...current.browser, ...patch.browser },
  };
  writeNamespace(workspaceSettingsFile(wsId), { ...next });
  return next;
}

/** 浏览器白名单（只有白名单域才归档 / 免提示打开）。 */
export function readBrowserAllowlist(wsId: string): string[] {
  return readWorkspacePolicy(wsId).browser.allowlist;
}

export function writeBrowserAllowlist(wsId: string, list: string[]): string[] {
  return writeWorkspacePolicy(wsId, { browser: { allowlist: list } }).browser
    .allowlist;
}

// ─── 文件读写（保留其余字段）──────────────────────────────

function readJson(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readNamespace(file: string): Record<string, unknown> {
  const value = readJson(file)[NAMESPACE];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function writeNamespace(file: string, value: Record<string, unknown>): void {
  const doc = { ...readJson(file), [NAMESPACE]: value };
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  renameSync(tmp, file);
}
