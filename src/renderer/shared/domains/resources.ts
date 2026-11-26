import { useEffect, useState } from 'react';
import type {
  ResourceForest,
  ResourceGroup,
  ResourceNode,
} from '../../../shared/resources.ts';
import { command, workStudio } from '../api/bridge.ts';
import { useWindowWorkspaceId } from './workspaces.ts';

/** 工作区资源森林：`workspace/<wsId>/resources`。 */
function resourcesResource(wsId: string): string {
  return `${wsId}/resources`;
}

/**
 * 资源森林资源由 workspace 模块动态创建；页面可能先于资源就绪加载，
 * 因此订阅返回 null 时短暂重试，而不是永久停留在空列表。
 */
export function useResourceForest(): ResourceGroup[] {
  const workspaceId = useWindowWorkspaceId();
  const [groups, setGroups] = useState<ResourceGroup[]>([]);
  useEffect(() => {
    const bridge = workStudio();
    if (!bridge || !workspaceId) return;
    const resource = resourcesResource(workspaceId);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateGroups = (data: unknown): boolean => {
      if (!data || typeof data !== 'object') return false;
      const forest = data as ResourceForest;
      if (!Array.isArray(forest.groups)) return false;
      setGroups(forest.groups);
      return true;
    };
    const off = bridge.onUpdate((update) => {
      if (update.domain !== 'workspace' || update.resource !== resource) return;
      if (update.type === 'snapshot' || update.type === 'patch') {
        updateGroups(update.data);
      }
    });
    const bind = (): void => {
      if (disposed) return;
      void bridge
        .subscribe('workspace', resource)
        .then((data) => {
          if (disposed) return;
          if (updateGroups(data)) return;
          timer = setTimeout(bind, 50);
        })
        .catch(() => {
          if (!disposed) timer = setTimeout(bind, 200);
        });
    };
    bind();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      off();
      bridge.unsubscribe('workspace', resource);
    };
  }, [workspaceId]);
  return groups;
}

async function windowWorkspaceId(): Promise<string | null> {
  const bridge = workStudio();
  if (!bridge) return null;
  if (bridge.workspaceId) return bridge.workspaceId;
  const registry = (await bridge.subscribe('workspace', 'registry')) as {
    current?: { id: string } | null;
  } | null;
  return registry?.current?.id ?? null;
}

export async function resourceAction(
  action: string,
  node?: ResourceNode,
  input?: Record<string, unknown>,
): Promise<unknown> {
  const workspaceId = await windowWorkspaceId();
  if (!workspaceId) throw new Error('没有当前工作区');
  return command('workspace', resourcesResource(workspaceId), 'action', {
    action,
    ...(node ? { node } : {}),
    ...(input ? { input } : {}),
  });
}

export async function openResourceNode(node: ResourceNode): Promise<unknown> {
  return resourceAction('open', node);
}
