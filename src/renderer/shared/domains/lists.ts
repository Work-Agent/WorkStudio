import type { ListGroup, ListItem } from '../../../shared/lists.ts';
import type { ListSnapshot } from '../../../shared/lists.ts';
import { command, useResource } from '../api/bridge.ts';

export function useLists(): ListGroup[] {
  const snapshot = useResource<ListSnapshot | null>('lists', 'current', {
    workspaceEpoch: 0,
    groups: [],
  });
  return snapshot?.groups ?? [];
}

export function openListItem(item: ListItem): Promise<unknown> {
  return command('lists', 'current', 'action', { action: 'open', item });
}
