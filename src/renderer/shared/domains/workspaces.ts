import type { WorkspaceMeta } from '../../../shared/app.ts';
import { command, useResource } from '../api/bridge.ts';

interface WorkspaceRegistry {
  current?: WorkspaceMeta | null;
  workspaces?: WorkspaceMeta[];
}

export function useWorkspaces(): {
  list: WorkspaceMeta[];
  current: WorkspaceMeta | null;
  open(path: string): Promise<WorkspaceMeta>;
  close(id: string): Promise<boolean>;
} {
  const registry = useResource<WorkspaceRegistry>('workspace', 'registry', {});
  return {
    list: registry.workspaces ?? [],
    current: registry.current ?? null,
    open: (path) =>
      command<WorkspaceMeta>('workspace', 'registry', 'open', { path }),
    close: (id) =>
      command<null>('workspace', 'registry', 'close', { id }).then(() => true),
  };
}
