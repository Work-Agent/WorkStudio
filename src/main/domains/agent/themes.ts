import type { LoadedResourcesView } from '../../../shared/types.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ThemesDeps {
  resources(): LoadedResourcesView;
}

/** themes：pi 资源层加载的主题。 */
export function defineThemesDomain(
  registry: DomainRegistry,
  deps: ThemesDeps,
): void {
  const resource = registry.define('themes').resource('list');
  resource.snapshot(() => deps.resources().themes);
}
