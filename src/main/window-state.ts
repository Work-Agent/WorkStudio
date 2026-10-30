/**
 * 窗口恢复清单（architecture.md §2.6）。
 *
 * 只记录「上次开着哪个工作区」，不记录几何——窗口与工作区一一对应，
 * 几何属于工作区现场（ui-state.json）。多窗口时这里会变成集合。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { windowsFile } from './paths';

export interface WindowState {
  /** 上次处于前台的工作区标识；无记录为 null。 */
  workspaceId: string | null;
}

export function readWindowState(): WindowState {
  const file = windowsFile();
  if (!existsSync(file)) return { workspaceId: null };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      workspaceId?: unknown;
    };
    return {
      workspaceId:
        typeof raw.workspaceId === 'string' && raw.workspaceId
          ? raw.workspaceId
          : null,
    };
  } catch {
    return { workspaceId: null };
  }
}

export function writeWindowState(state: WindowState): void {
  const file = windowsFile();
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  renameSync(tmp, file);
}
