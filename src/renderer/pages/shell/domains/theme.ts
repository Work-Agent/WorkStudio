import { command, useResource } from '../../../shared/api/bridge.ts';

interface AppearanceState {
  theme?: 'light' | 'dark';
  source?: 'light' | 'dark' | 'system';
}

export function useTheme(): {
  theme: 'light' | 'dark';
  set(theme: string): void;
  toggle(): void;
} {
  const state = useResource<AppearanceState>('shell', 'appearance', {
    theme: 'dark',
    source: 'system',
  });
  const theme = state.theme ?? 'dark';
  const set = (next: string): void => {
    void command('shell', 'appearance', 'set', {
      source: next,
    }).catch(() => undefined);
  };
  return {
    theme,
    set,
    toggle: () => set(theme === 'dark' ? 'light' : 'dark'),
  };
}
