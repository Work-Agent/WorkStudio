import type { LoadedResourcesView } from '../../../shared/types.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface PromptsDeps {
  resources(): LoadedResourcesView;
}

/** prompts：pi 已加载的提示词模板。 */
export function definePromptsDomain(
  registry: DomainRegistry,
  deps: PromptsDeps,
): void {
  const resource = registry.define('prompts').resource('list');
  resource.snapshot(() => deps.resources().prompts);
}
