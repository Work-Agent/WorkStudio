import type { LoadedResourcesView } from '../../../shared/types.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ExtensionsDeps {
  ensure(): Promise<void>;
  resources(): LoadedResourcesView;
  reload(): Promise<void>;
}

/** extensions：pi 已加载扩展、装载错误与热重载。 */
export function defineExtensionsDomain(
  registry: DomainRegistry,
  deps: ExtensionsDeps,
): void {
  const domain = registry.define('extensions');
  const list = domain.resource('list');
  list.snapshot(() => deps.resources().extensions);
  list.command<null, null>('reload', async () => {
    await deps.ensure();
    await deps.reload();
    list.publish();
    domain.resource('errors').publish();
    return null;
  });

  const errors = domain.resource('errors');
  errors.snapshot(() => deps.resources().errors);
}
