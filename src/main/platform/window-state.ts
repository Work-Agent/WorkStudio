/**
 * 窗口/工作区现场：只保存最近工作区 id，窗口几何由 Electron 宿主管理。
 */

import { readJsonFile, writeJson } from './json.ts';
import type { StorageLayout } from './paths.ts';

export interface WindowState {
  workspaceId: string | null;
}

export function readWindowState(layout: StorageLayout): WindowState {
  const raw = readJsonFile<{ workspaceId?: unknown }>(layout.windowsFile);
  return {
    workspaceId: typeof raw?.workspaceId === 'string' ? raw.workspaceId : null,
  };
}

export function writeWindowState(
  layout: StorageLayout,
  state: WindowState,
): void {
  writeJson(layout.windowsFile, state);
}
