import { setDisplayWorkspace } from '../api/pathDisplay';
/**
 * 壳层投影：在 app 主进程下，把 app state 映射到现有 zustand store。
 *
 * 先覆盖壳层需要的 layout / views / theme / workspaces / lists / 当前会话；
 * 只消费 appBridge 状态帧；不再有 AppSnapshot 回退。
 */
import type { AppFrame } from '../../shared/electron';
import type { WorkspaceMeta } from '../../shared/app';
import type {
  AgentSnapshot,
  LayoutSnapshot,
  ViewEntry,
} from '../../shared/types';
import type { ViewSnapshot } from '../../main/framework/views';
import type { ListSnapshot } from '../../shared/lists';
import { useAppStore, toAgentStatus } from './app';
import { useUiStore } from './ui';
import { useWorkspaceStore } from './workspace';
import { useNotificationsStore } from './notifications';
import {
  setCurrentWorkspaceId,
  setCurrentWorkspacePath,
} from '../api/appCommands';

let initialized = false;

function viewEntry(view: ViewSnapshot): ViewEntry {
  return {
    id: view.id,
    tabKey: view.tabKey,
    type: view.type === 'web' ? 'browser' : 'extension',
    extensionId: view.id,
    title: view.title,
    url: view.url,
    state:
      view.state === 'ready'
        ? 'ready'
        : view.state === 'crashed'
          ? 'error'
          : 'loading',
    active: view.active,
    pinned: view.pinned,
    dirty: view.dirty,
  };
}

function workspaceInfo(
  meta: WorkspaceMeta,
  currentId: string | null,
): {
  path: string;
  name: string;
  wsId: string;
  createdAt: number;
  lastOpenedAt: number;
  current: boolean;
  exists: boolean;
} {
  return {
    path: meta.path,
    name: meta.name,
    wsId: meta.id,
    createdAt: meta.createdAt,
    lastOpenedAt: meta.lastOpenedAt,
    current: meta.id === currentId,
    exists: true,
  };
}

export async function initAppRoutes(): Promise<void> {
  if (initialized) return;
  const bridge = window.appBridge;
  if (!bridge) return;
  initialized = true;

  let currentId: string | null = null;
  const watched = new Set<string>();
  const seenNotices = new Set<string>();
  const watch = (path: string): void => {
    if (watched.has(path)) return;
    watched.add(path);
    void bridge.watch([path]);
  };

  const apply = (frame: AppFrame): void => {
    if (frame.type !== 'state') return;
    switch (frame.path) {
      case '/layout':
        useWorkspaceStore.setState({
          layout: frame.value as LayoutSnapshot,
        });
        break;
      case '/views':
        useWorkspaceStore.setState({
          views: (frame.value as ViewSnapshot[]).map(viewEntry),
        });
        break;
      case '/theme':
        useUiStore.setState({ theme: frame.value as 'light' | 'dark' });
        break;
      case '/notices': {
        const notices = frame.value as Array<{
          id: string;
          level: 'info' | 'warn' | 'error';
          message: string;
          source?: string;
        }>;
        for (const notice of notices) {
          if (seenNotices.has(notice.id)) continue;
          seenNotices.add(notice.id);
          useNotificationsStore.getState().push({
            ...notice,
            level: notice.level === 'warn' ? 'warning' : notice.level,
          });
        }
        break;
      }
      case '/workspaces': {
        const list = frame.value as WorkspaceMeta[];
        useAppStore.setState({
          workspaces: list.map((meta) => workspaceInfo(meta, currentId)),
        });
        break;
      }
      case '/workspaces/current': {
        const current = frame.value as WorkspaceMeta | null;
        currentId = current?.id ?? null;
        setCurrentWorkspaceId(currentId);
        setDisplayWorkspace(current?.id ?? null, current?.path ?? null);
        setCurrentWorkspacePath(current?.path ?? null);
        const status = useAppStore.getState().status;
        useAppStore.setState({
          status: {
            ...status,
            ...(current ? { workspacePath: current.path } : {}),
          },
        });
        if (current) {
          watch(`/workspaces/${current.id}/lists`);
          watch(`/workspaces/${current.id}/sessions/current`);
          watch(`/scene/${current.id}`);
        }
        break;
      }
      default: {
        if (frame.path.endsWith('/lists')) {
          useWorkspaceStore.setState({
            groups: (frame.value as ListSnapshot).groups,
          });
        } else if (frame.path.startsWith('/scene/')) {
          const scene = frame.value as {
            sidebarCollapsed?: boolean;
            aiOpen?: boolean;
            aiFloating?: boolean;
            paneWidths?: { left: number; right: number };
          };
          useUiStore.setState({
            ...(scene.sidebarCollapsed !== undefined
              ? { sidebarCollapsed: scene.sidebarCollapsed }
              : {}),
            ...(scene.aiOpen !== undefined ? { aiOpen: scene.aiOpen } : {}),
            ...(scene.aiFloating !== undefined
              ? { aiFloating: scene.aiFloating }
              : {}),
            ...(scene.paneWidths ? { paneWidths: scene.paneWidths } : {}),
          });
        } else if (frame.path.endsWith('/sessions/current')) {
          const snapshot = frame.value as AgentSnapshot | null;
          if (snapshot) {
            const status = useAppStore.getState().status;
            useAppStore.setState({
              status: {
                ...toAgentStatus(snapshot),
                ...(status.workspacePath
                  ? { workspacePath: status.workspacePath }
                  : {}),
              },
            });
          }
        }
        break;
      }
    }
  };

  bridge.on(apply);
  await bridge.watch([
    '/layout',
    '/views',
    '/theme',
    '/workspaces',
    '/workspaces/current',
    '/notices',
  ]);
}
