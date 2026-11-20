import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';
import type { WorkspacesRepo } from './repo.ts';

export interface WorkspaceActions {
  current(): WorkspaceMeta | null;
  open(id: string): void;
  close(id: string): void;
}

export function defineWorkspacesDomain(
  registry: DomainRegistry,
  repo: WorkspacesRepo,
  actions: WorkspaceActions,
): void {
  const domain = registry.define('workspaces');
  const list = domain.resource('list');
  const current = domain.resource('current');
  const publish = (): void => {
    list.publish();
    current.publish();
  };

  list.snapshot(() => repo.list());
  current.snapshot(() => actions.current());
  list.command<{ path: string }, WorkspaceMeta>('open', (call) => {
    const meta = repo.register(String(call.input?.path ?? ''));
    actions.open(meta.id);
    publish();
    return meta;
  });
  list.command<{ id: string }, boolean>('close', (call) => {
    actions.close(String(call.input?.id ?? ''));
    publish();
    return true;
  });
  list.command<{ id: string; name: string }, WorkspaceMeta | null>(
    'rename',
    (call) => {
      const meta = repo.rename(
        String(call.input?.id ?? ''),
        String(call.input?.name ?? ''),
      );
      publish();
      return meta;
    },
  );
  list.command<{ id: string }, null>('remove', (call) => {
    repo.remove(String(call.input?.id ?? ''));
    publish();
    return null;
  });
  list.command<null, null>('refresh', () => {
    publish();
    return null;
  });
}
