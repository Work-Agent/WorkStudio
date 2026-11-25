/** 应用外观契约：主题来源 + 内容视图缩放百分比。 */

/**
 * 首帧底色：页面 CSS 尚未加载时先按系统深浅铺底，避免深色模式出现白闪。
 * 页面自己的样式表随后覆盖；透明页（capture / overlay）在内联样式中显式透明。
 * 系统页构建、插件页响应与 Vite dev 注入共用这一份。
 */
export const THEME_GATE_STYLE =
  'html{background:#f4f4f5;color-scheme:light}@media (prefers-color-scheme:dark){html{background:#1a1c1d;color-scheme:dark}}';

/** 是否已经带首帧底色（避免重复注入）。 */
export function hasThemeGate(html: string): boolean {
  return html.includes('prefers-color-scheme:dark');
}

/** 在 <head> 后注入首帧底色；没有 head 时插到文档开头。 */
export function injectThemeGate(html: string): string {
  if (hasThemeGate(html)) return html;
  const style = `<style>${THEME_GATE_STYLE}</style>`;
  return html.includes('<head>')
    ? html.replace('<head>', `<head>${style}`)
    : `${style}${html}`;
}
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
