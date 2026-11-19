import { command, useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

export interface SceneState {
  sidebarCollapsed?: boolean;
  aiOpen?: boolean;
  aiFloating?: boolean;
  paneWidths?: { left: number; right: number };
}

export function useScene(): {
  scene: SceneState;
  patch(patch: SceneState): void;
} {
  const wsId = useActiveWorkspaceId();
  const scene = useResource<SceneState>('scene', wsId ?? 'none', {});
  const patch = (next: SceneState): void => {
    if (!wsId) return;
    void command('scene', wsId, 'patch', next).catch(() => undefined);
  };
  return { scene: scene ?? {}, patch };
}

export function useSceneValue<T>(
  value: (scene: SceneState) => T | undefined,
  fallback: T,
): T {
  return value(useScene().scene) ?? fallback;
}
