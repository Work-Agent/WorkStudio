import { useCallback } from 'react';
import type { ViewEntry } from '../../../../shared/types.ts';
import { command, useResource } from '../../../shared/api/bridge.ts';
import { useWindowWorkspaceId } from '../../../shared/domains/workspaces.ts';

interface ViewSnapshot {
  id: string;
  type: string;
  title: string;
  url?: string;
  active: boolean;
  pinned: boolean;
  dirty: boolean;
}

function viewEntry(view: ViewSnapshot): ViewEntry {
  return {
    id: view.id,
    tabKey: view.id,
    type: view.type === 'web' ? 'browser' : 'extension',
    extensionId: view.id,
    title: view.title,
    url: view.url ?? '',
    state: 'ready',
    active: view.active,
    pinned: view.pinned,
    dirty: view.dirty,
    missing: false,
    conflict: false,
  };
}

export function useViews(): ViewEntry[] {
  const wsId = useWindowWorkspaceId();
  const views = useResource<ViewSnapshot[]>(
    'shell',
    wsId ? `${wsId}/views` : null,
    [],
  );
  return views.map(viewEntry);
}

export function useViewCommands(): (
  commandName: string,
  params?: unknown,
) => void {
  const wsId = useWindowWorkspaceId();
  return useCallback(
    (commandName: string, params: unknown = {}): void => {
      if (!wsId) return;
      const input =
        (params as { input?: unknown } | undefined)?.input ?? params;
      const value = (input ?? {}) as Record<string, unknown>;
      const id = String(
        value['id'] ?? value['viewId'] ?? value['fromId'] ?? '',
      );
      const send = (
        action: string,
        data: Record<string, unknown> = {},
      ): void => {
        void command('shell', `${wsId}/views`, action, data).catch(
          () => undefined,
        );
      };
      switch (commandName) {
        case 'views.activate':
          return send('activate', { id });
        case 'views.close':
          return send('close', { id });
        case 'views.togglePin':
          return send('pin', { id });
        case 'views.move':
          return send('move', {
            fromId: id,
            toId: String(value['toId'] ?? ''),
          });
        case 'views.reload':
          void command('shell', `${wsId}/view/${id}`, 'reload').catch(
            () => undefined,
          );
          return;
        case 'views.closeOthers':
          return send('closeOthers', { id });
        case 'views.closeToLeft':
          return send('closeLeft', { id });
        case 'views.closeToRight':
          return send('closeRight', { id });
        case 'views.closeAll':
          return send('closeAll');
        case 'views.goBack':
          return send('goBack', { id });
        case 'views.goForward':
          return send('goForward', { id });
        case 'views.navigate':
          void command('shell', `${wsId}/view/${id}`, 'navigate', {
            url: String(value['url'] ?? ''),
          }).catch(() => undefined);
          return;
        case 'views.action':
        case 'views.runAction':
          return send('runAction', { id });
        default:
          return;
      }
    },
    [wsId],
  );
}
