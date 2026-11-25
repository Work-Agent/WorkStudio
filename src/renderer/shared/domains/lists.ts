import type { ListGroup, ListItem } from '../../../shared/lists.ts';
import type { ListSnapshot } from '../../../shared/lists.ts';
import { command, useResource, workStudio } from '../api/bridge.ts';
import { useWindowWorkspaceId } from './workspaces.ts';

/** 工作区是 resource 路径中的 scope：`workspace/<wsId>/list`。 */
function listResource(wsId: string): string {
  return `${wsId}/list`;
}

export function useLists(): ListGroup[] {
  const workspaceId = useWindowWorkspaceId();
  const snapshot = useResource<ListSnapshot | null>(
    'workspace',
    workspaceId ? listResource(workspaceId) : null,
    {
      workspaceEpoch: 0,
      groups: [],
    },
  );
  return snapshot?.groups ?? [];
}

async function windowWorkspaceId(): Promise<string | null> {
  const bridge = workStudio();
  if (!bridge) return null;
  if (bridge.workspaceId) return bridge.workspaceId;
  const registry = (await bridge.subscribe('workspace', 'registry')) as {
    current?: { id?: string } | null;
  } | null;
  return registry?.current?.id ?? null;
}

export async function openListItem(item: ListItem): Promise<unknown> {
  const workspaceId = await windowWorkspaceId();
  if (!workspaceId) throw new Error('没有当前工作区');
  return command('workspace', listResource(workspaceId), 'action', {
    action: 'open',
    item,
  });
}
