import type { LayoutSnapshot } from '../../../../shared/types.ts';
import { useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

interface LayoutRecord {
  windowId: string;
  snapshot: LayoutSnapshot | null;
}

/** 布局按窗口订阅：`shell/<wsId>/layout`（窗口与工作区 1:1）。 */
export function useLayout(): LayoutSnapshot | null {
  const wsId = useActiveWorkspaceId();
  const record = useResource<LayoutRecord | null>(
    'shell',
    wsId ? `${wsId}/layout` : null,
    null,
  );
  return record?.snapshot ?? null;
}
