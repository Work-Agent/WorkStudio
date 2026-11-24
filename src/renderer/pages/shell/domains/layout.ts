import type { LayoutSnapshot, UiState } from '../../../../shared/types.ts';
import { computeLayout } from '../../../../shared/layout-engine.ts';
import { useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

interface LayoutRecord {
  windowId: string;
  snapshot: LayoutSnapshot | null;
}

export function useLayout(): LayoutSnapshot | null {
  const wsId = useActiveWorkspaceId();
  const records = useResource<LayoutRecord[]>('shell', 'layout', []);
  return records.find((record) => record.windowId === wsId)?.snapshot ?? null;
}
