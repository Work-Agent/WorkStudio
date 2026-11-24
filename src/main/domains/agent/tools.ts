import type { LoadedResourcesView } from '../../../shared/types.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ToolView {
  extension: string;
  name: string;
}

export interface ToolsDeps {
  resources(): LoadedResourcesView;
}

/** tools：扩展注册给 pi 的工具。 */
export function defineToolsDomain(
  registry: DomainRegistry,
  deps: ToolsDeps,
): void {
  const resource = registry.define('tools').resource('list');
  resource.snapshot(() =>
    deps
      .resources()
      .extensions.flatMap((extension) =>
        extension.tools.map((name) => ({ extension: extension.path, name })),
      ),
  );
}
