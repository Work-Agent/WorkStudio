/** 应用外观契约；独立内容视图与工作台使用同一组语义颜色。 */
export type SkinId = 'black' | 'graphite' | 'porcelain' | 'mist';
export interface AppearanceSettings {
  mode: 'fixed' | 'system';
  skin: SkinId;
  lightSkin: 'porcelain' | 'mist';
  darkSkin: 'black' | 'graphite';
  editorSize: number;
}
export interface AppearanceSnapshot extends AppearanceSettings {
  effectiveSkin: SkinId;
  theme: 'light' | 'dark';
}
export const SKINS = {
  black: {
    label: '曜黑',
    theme: 'dark',
    bg: '#000000',
    surface: '#0b0c0f',
    top: '#08090b',
    text: '#e7e9ee',
    muted: '#a2a9b6',
    border: '#2c3039',
    accent: '#a8b5ff',
    selected: '#1d2846',
    success: '#82cba5',
    danger: '#f4a4aa',
    warning: '#e7c58a',
    ink: '#172144',
  },
  graphite: {
    label: '石墨',
    theme: 'dark',
    bg: '#22252b',
    surface: '#1c1f24',
    top: '#191c21',
    text: '#e7eaf0',
    muted: '#a6afbe',
    border: '#414754',
    accent: '#b3bfff',
    selected: '#35415f',
    success: '#9bd5b5',
    danger: '#f6b1b6',
    warning: '#edcd94',
    ink: '#1d2749',
  },
  porcelain: {
    label: '白瓷',
    theme: 'light',
    bg: '#ffffff',
    surface: '#f5f6f9',
    top: '#edf0f5',
    text: '#282d37',
    muted: '#5e697a',
    border: '#dce1ea',
    accent: '#455dc4',
    selected: '#e9edff',
    success: '#216a49',
    danger: '#a8333e',
    warning: '#805513',
    ink: '#ffffff',
  },
  mist: {
    label: '雾蓝',
    theme: 'light',
    bg: '#f4f8fc',
    surface: '#eaf0f7',
    top: '#e1eaf4',
    text: '#25354a',
    muted: '#53677f',
    border: '#cbd8e8',
    accent: '#315d9a',
    selected: '#dce8f8',
    success: '#216546',
    danger: '#a73742',
    warning: '#7b531b',
    ink: '#ffffff',
  },
} as const;
export function normalizeAppearance(
  raw: Partial<AppearanceSettings> = {},
  legacy: 'light' | 'dark' = 'dark',
): AppearanceSettings {
  return {
    mode: raw.mode === 'system' ? 'system' : 'fixed',
    skin:
      raw.skin && Object.hasOwn(SKINS, raw.skin)
        ? raw.skin
        : legacy === 'light'
          ? 'porcelain'
          : 'black',
    lightSkin: raw.lightSkin === 'mist' ? 'mist' : 'porcelain',
    darkSkin: raw.darkSkin === 'graphite' ? 'graphite' : 'black',
    editorSize: [14, 15, 16, 18].includes(raw.editorSize ?? 0)
      ? raw.editorSize!
      : 14,
  };
}
export function resolveAppearance(
  settings: AppearanceSettings,
  systemDark: boolean,
): AppearanceSnapshot {
  const effectiveSkin =
    settings.mode === 'system'
      ? systemDark
        ? settings.darkSkin
        : settings.lightSkin
      : settings.skin;
  return { ...settings, effectiveSkin, theme: SKINS[effectiveSkin].theme };
}
export function appearanceCss(snapshot: AppearanceSnapshot): string {
  const s = SKINS[snapshot.effectiveSkin];
  const vars: Record<string, string> = {
    'biz-bg': s.bg,
    'biz-surface': s.surface,
    'biz-surface-2': s.top,
    'biz-surface-hover': s.selected,
    'biz-surface-input': s.bg,
    'biz-border': s.border,
    'biz-border-subtle': s.border,
    'biz-text': s.text,
    'biz-text-secondary': s.text,
    'biz-text-muted': s.muted,
    'biz-text-subtle': s.muted,
    'biz-accent': s.accent,
    'biz-accent-hover': s.accent,
    'biz-accent-dim': s.selected,
    'biz-danger': s.danger,
    'biz-warning': s.warning,
    'biz-success': s.success,
    'biz-primary-ink': s.ink,
    bg: s.bg,
    panel: s.surface,
    card: s.surface,
    fg: s.text,
    muted: s.muted,
    border: s.border,
    line: s.border,
    accent: s.accent,
    'accent-hover': s.accent,
    'input-bg': s.bg,
    soft: s.surface,
    hover: s.selected,
    'code-bg': s.surface,
    danger: s.danger,
    warn: s.warning,
    ok: s.success,
    gutter: s.muted,
    quote: s.muted,
    'editor-size': `${snapshot.editorSize}px`,
    'md-size': `${snapshot.editorSize}px`,
  };
  return `:root { color-scheme: ${snapshot.theme} !important; ${Object.entries(
    vars,
  )
    .map(([key, value]) => `--${key}:${value} !important;`)
    .join('')} }
    :focus-visible { outline: 2px solid var(--biz-accent) !important; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`;
}
