import { useCallback } from 'react';
import type { ViewEntry } from '../../../../shared/types.ts';
import { command, useResource } from '../../../shared/api/bridge.ts';
import { useActiveWorkspaceId } from './windows.ts';

interface ViewSnapshot {
  id: string;
  tabKey: string;
  type: string;
  title: string;
  url: string;
  state: string;
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  missing: boolean;
  conflict: boolean;
  actionStates?: Record<string, string>;
}

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
    missing: view.missing,
    conflict: view.conflict,
    actionStates: view.actionStates,
  };
}

export function useViews(): ViewEntry[] {
  const wsId = useActiveWorkspaceId();
  const snapshot = useResource<{ list?: ViewSnapshot[] }>(
    'tabs',
    wsId ?? 'none',
    { list: [] },
  );
  return (snapshot?.list ?? []).map(viewEntry);
}

export function useViewCommands(): (
  commandName: string,
  params?: unknown,
) => void {
  const wsId = useActiveWorkspaceId();
  return useCallback(
    (commandName: string, params: unknown = {}): void => {
      if (!wsId) return;
      const input =
        (params as { input?: unknown } | undefined)?.input ?? params;
      const value = (input ?? {}) as Record<string, unknown>;
      const id = String(
        value['id'] ?? value['viewId'] ?? value['fromId'] ?? '',
      );
      const action = commandName.slice('views.'.length);
      const send = (name: string, data?: unknown): void => {
        void command('tabs', wsId, name, data).catch(() => undefined);
      };
      switch (commandName) {
        case 'views.activate':
          return send('activate', id);
        case 'views.close':
          return send('close', id);
        case 'views.togglePin':
          return send('togglePin', id);
        case 'views.move':
          return send('move', {
            fromId: id,
            toId: String(value['toId'] ?? ''),
          });
        case 'views.reload':
          return send('refresh', id);
        case 'views.closeOthers':
          return send('closeOthers', id);
        case 'views.closeToLeft':
          return send('closeToLeft', id);
        case 'views.closeToRight':
          return send('closeToRight', id);
        case 'views.closeAll':
          return send('closeAll');
        case 'views.goBack':
          return send('goBack', id);
        case 'views.goForward':
          return send('goForward', id);
        case 'views.navigate':
          return send('navigate', {
            id,
            url: String(value['url'] ?? ''),
          });
        case 'views.action':
        case 'views.runAction':
          return send(action === 'runAction' ? 'runAction' : 'action', {
            id,
            action: String(value['action'] ?? ''),
          });
        default:
          return;
      }
    },
    [wsId],
  );
}
