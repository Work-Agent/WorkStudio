import type { LayoutSnapshot } from '../../../../shared/types.ts';
import { useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

export function useLayout(): LayoutSnapshot | null {
  const wsId = useActiveWorkspaceId();
  return useResource<LayoutSnapshot | null>('layout', wsId ?? 'none', null);
}
