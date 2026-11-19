import type { DomainRegistry } from '../runtime/domains.ts';
import type { ThemeManager, WindowManager } from '../runtime/native.ts';
import type { Theme, ThemeSource } from '../runtime/shared.ts';

export interface ThemeState {
  theme: Theme;
  themeSource: ThemeSource;
}

/** theme/current：主题来源 + 有效主题；变化时同步所有窗口的原生外观。 */
export function defineThemeDomain(
  registry: DomainRegistry,
  theme: ThemeManager,
  windows: WindowManager,
  onSet?: (source: ThemeSource) => void,
): () => void {
  const resource = registry.define('theme').resource('current');
  resource.snapshot(
    (): ThemeState => ({
      theme: theme.read(),
      themeSource: theme.readSource(),
    }),
  );
  resource.command<ThemeSource, ThemeState>('set', (call) => {
    theme.apply(call.input);
    onSet?.(call.input);
    return { theme: theme.read(), themeSource: theme.readSource() };
  });
  return theme.subscribe(() => {
    const next = theme.read();
    for (const window of windows.list()) window.applyTheme(next);
    resource.patch({ theme: next, themeSource: theme.readSource() });
  });
}
