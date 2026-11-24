/** 窗口场景的持久化：只存用户操作结果，不存布局矩形。 */
import { readJsonFile, writeJson } from './json.ts';

export interface StoredScene {
  sidebarCollapsed?: boolean;
  aiOpen?: boolean;
  aiFloating?: boolean;
  paneWidths?: { left: number; right: number };
  floating?: { x: number; y: number; width: number; height: number } | null;
}

type StoredScenes = Record<string, StoredScene>;

export function readScenes(file: string): StoredScenes {
  const raw = readJsonFile<Record<string, unknown>>(file);
  const scenes: StoredScenes = {};
  for (const [id, value] of Object.entries(raw ?? {})) {
    if (typeof value !== 'object' || value === null) continue;
    const item = value as StoredScene;
    scenes[id] = {
      ...(typeof item.sidebarCollapsed === 'boolean'
        ? { sidebarCollapsed: item.sidebarCollapsed }
        : {}),
      ...(typeof item.aiOpen === 'boolean' ? { aiOpen: item.aiOpen } : {}),
      ...(typeof item.aiFloating === 'boolean'
        ? { aiFloating: item.aiFloating }
        : {}),
      ...(isWidths(item.paneWidths) ? { paneWidths: item.paneWidths } : {}),
      ...(item.floating === null || isRect(item.floating)
        ? { floating: item.floating ?? null }
        : {}),
    };
  }
  return scenes;
}

export function writeScene(file: string, id: string, scene: StoredScene): void {
  const all = readScenes(file);
  all[id] = scene;
  writeJson(file, all);
}

function isWidths(value: unknown): value is { left: number; right: number } {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { left?: unknown; right?: unknown };
  return (
    typeof item.left === 'number' &&
    Number.isFinite(item.left) &&
    typeof item.right === 'number' &&
    Number.isFinite(item.right)
  );
}

function isRect(value: unknown): value is NonNullable<StoredScene['floating']> {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  );
}
