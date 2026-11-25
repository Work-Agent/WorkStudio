/** 场景投影：写入 shell/<wsId>/layout 的 scene 字段；没有持久值时用默认三栏。 */
import { useCallback } from 'react';
import { command, useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

export interface SceneState {
  sidebarCollapsed?: boolean;
  aiOpen?: boolean;
  aiFloating?: boolean;
  paneWidths?: { left: number; right: number };
}

interface LayoutRecord {
  windowId: string;
  scene?: SceneState;
}

const EMPTY: SceneState = {
  sidebarCollapsed: false,
  aiOpen: true,
  aiFloating: false,
  paneWidths: { left: 240, right: 420 },
};

export function useScene(): {
  scene: SceneState;
  patch(patch: SceneState): void;
} {
  const wsId = useActiveWorkspaceId();
  const record = useResource<LayoutRecord | null>(
    'shell',
    wsId ? `${wsId}/layout` : null,
    null,
  );
  const scene = record?.scene;
  const patch = useCallback(
    (next: SceneState) => {
      if (!wsId) return;
      void command('shell', `${wsId}/layout`, 'scene', {
        patch: next,
      }).catch(() => undefined);
    },
    [wsId],
  );
  return {
    scene: { ...EMPTY, ...scene },
    patch,
  };
}

export function useSceneValue<T>(
  value: (scene: SceneState) => T | undefined,
  fallback: T,
): T {
  return value(useScene().scene) ?? fallback;
}
