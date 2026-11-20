import type { ListItem, ListSnapshot } from '../../../shared/lists.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';

export interface ListsDeps {
  snapshot(): ListSnapshot | null;
  refresh(): Promise<void>;
  openItem(item: ListItem): Promise<unknown>;
}

/** lists/<scope>：侧栏快照；只做聚合，不定义页面。 */
export function defineListsDomain(
  registry: DomainRegistry,
  deps: ListsDeps,
  resourceName = 'current',
): void {
  const resource = registry.define('lists').resource(resourceName);
  resource.snapshot(() => deps.snapshot() ?? { workspaceEpoch: 0, groups: [] });
  resource.command<null, null>('refresh', async () => {
    await deps.refresh();
    return null;
  });
  resource.command<{ action?: string; item?: ListItem }, unknown>(
    'action',
    (call) => {
      if (call.input?.action !== 'open' || !call.input.item)
        throw new Error('unsupported list action');
      return deps.openItem(call.input.item);
    },
  );
}
