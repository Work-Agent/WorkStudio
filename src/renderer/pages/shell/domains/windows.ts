import { useResource } from '../../../shared/api/bridge.ts';

interface WorkspaceRegistry {
  current?: { id?: string } | null;
}

export function useActiveWorkspaceId(): string | null {
  const registry = useResource<WorkspaceRegistry>('workspace', 'registry', {
    current: null,
  });
  return registry.current?.id ?? null;
}
