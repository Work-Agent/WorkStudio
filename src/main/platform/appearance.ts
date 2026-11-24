/**
 * 外观状态：shell/appearance 的唯一持久化入口。
 *
 * 读数据根 settings.json 的 workspaceStudio.appearance；写入时同时保留
 * legacy theme 字段，便于旧数据平滑读取。
 */

import {
  normalizeAppearance,
  type AppearanceSettings,
} from '../../shared/appearance.ts';
import { readNamespace, writeNamespace } from './json.ts';
import type { StorageLayout } from './paths.ts';
import { SETTINGS_NAMESPACE } from './preferences.ts';

export class AppearanceStore {
  constructor(private readonly file: string) {}

  read(): AppearanceSettings {
    const raw = readNamespace(this.file, SETTINGS_NAMESPACE);
    const appearance =
      typeof raw['appearance'] === 'object' && raw['appearance'] !== null
        ? (raw['appearance'] as Partial<AppearanceSettings>)
        : {};
    const legacy = raw['theme'] === 'light' ? 'light' : 'dark';
    return normalizeAppearance(appearance, legacy);
  }

  write(settings: AppearanceSettings): AppearanceSettings {
    const normalized = normalizeAppearance(settings);
    writeNamespace(this.file, SETTINGS_NAMESPACE, {
      appearance: normalized,
      theme: normalized.theme === 'system' ? undefined : normalized.theme,
    });
    return normalized;
  }
}

export function createAppearanceStore(layout: StorageLayout): AppearanceStore {
  return new AppearanceStore(layout.userSettingsFile);
}
