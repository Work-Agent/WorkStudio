import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ListGroup, ListItem } from '../../../shared/lists.ts';
import type { ListSnapshot } from '../../../shared/lists.ts';
import { command, useResource, workStudio } from '../api/bridge.ts';

/** 工作区是 resource 路径中的 scope，不是 domain。 */
function listScope(wsId?: string | null): string {
  return wsId ? `ws:${wsId}` : 'current';
}

export function useLists(): ListGroup[] {
  const current = useResource<WorkspaceMeta | null>(
    'workspaces',
    'current',
    null,
  );
  const snapshot = useResource<ListSnapshot | null>(
    'lists',
    listScope(current?.id),
    {
      workspaceEpoch: 0,
      groups: [],
    },
  );
  return snapshot?.groups ?? [];
}

export async function openListItem(item: ListItem): Promise<unknown> {
  const current = (await workStudio()?.subscribe(
    'workspaces',
    'current',
  )) as WorkspaceMeta | null;
  return command('lists', listScope(current?.id), 'action', {
    action: 'open',
    item,
  });
}
