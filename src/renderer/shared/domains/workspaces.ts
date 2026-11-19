import type { WorkspaceMeta } from '../../../shared/app.ts';
import { command, useResource } from '../api/bridge.ts';

export function useWorkspaces(): {
  list: WorkspaceMeta[];
  current: WorkspaceMeta | null;
  open(path: string): Promise<WorkspaceMeta>;
  close(id: string): Promise<boolean>;
} {
  const list = useResource<WorkspaceMeta[] | null>('workspaces', 'list', []);
  const current = useResource<WorkspaceMeta | null>(
    'workspaces',
    'current',
    null,
  );
  return {
    list: list ?? [],
    current,
    open: (path) =>
      command<WorkspaceMeta>('workspaces', 'list', 'open', { path }),
    close: (id) => command<boolean>('workspaces', 'list', 'close', { id }),
  };
}
