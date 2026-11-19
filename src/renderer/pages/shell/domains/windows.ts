import { useResource } from '../../../shared/api/bridge.ts';

export interface WindowState {
  activeWsId: string | null;
  count: number;
  list: Array<{ wsId: string; windowId: number }>;
}

const EMPTY: WindowState = { activeWsId: null, count: 0, list: [] };

export function useActiveWorkspaceId(): string | null {
  return (
    useResource<WindowState | null>('windows', 'list', EMPTY)?.activeWsId ??
    null
  );
}
