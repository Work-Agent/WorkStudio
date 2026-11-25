import type { WorkspaceMeta } from '../../../shared/app.ts';
import { command, useResource, useWorkspaceId } from '../api/bridge.ts';

interface WorkspaceRegistry {
  current?: WorkspaceMeta | null;
  workspaces?: WorkspaceMeta[];
}

/** 窗口自己绑定的工作区（窗口与工作区 1:1）；未注入时退回当前工作区。 */
export function useWindowWorkspaceId(): string | null {
  const injected = useWorkspaceId();
  const registry = useResource<WorkspaceRegistry>('workspace', 'registry', {});
  return injected ?? registry.current?.id ?? null;
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
