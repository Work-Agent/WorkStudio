import { command, useResource } from '../../../shared/api/bridge.ts';

export interface ThemeState {
  theme: 'light' | 'dark';
  themeSource: 'light' | 'dark' | 'system';
}

export function useTheme(): {
  theme: 'light' | 'dark';
  set(theme: string): void;
  toggle(): void;
} {
  const state = useResource<ThemeState | null>('shell', 'theme', {
    theme: 'dark',
    themeSource: 'system',
  });
  const theme = state?.theme ?? 'dark';
  const set = (theme: string): void => {
    void command('shell', 'theme', 'set', theme).catch(() => undefined);
  };
  return {
    theme,
    set,
    toggle: () => set(theme === 'dark' ? 'light' : 'dark'),
  };
}
