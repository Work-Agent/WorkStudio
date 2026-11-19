/** 应用外观契约：主题来源 + 内容视图缩放百分比。 */
export type AppearanceTheme = 'light' | 'dark' | 'system';

export interface AppearanceSettings {
  /** light / dark / system；与浏览器 color-scheme 语义一致。 */
  theme: AppearanceTheme;
  /** 内容视图缩放百分比（100 = 默认）。 */
  zoom: number;
}

export interface AppearanceSnapshot extends AppearanceSettings {
  /** 当前实际生效的亮 / 暗主题（system 时由系统决定）。 */
  effectiveTheme: 'light' | 'dark';
}

export function normalizeZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(50, Math.round(value)));
}

export function normalizeAppearance(
  raw: Partial<AppearanceSettings> = {},
  legacy: 'light' | 'dark' = 'dark',
): AppearanceSettings {
  const theme =
    raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
      ? raw.theme
      : legacy;
  return {
    theme,
    zoom: normalizeZoom(raw.zoom),
  };
}

export function resolveAppearance(
  settings: AppearanceSettings,
  systemDark: boolean,
): AppearanceSnapshot {
  const effectiveTheme =
    settings.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : settings.theme;
  return { ...settings, effectiveTheme };
}
