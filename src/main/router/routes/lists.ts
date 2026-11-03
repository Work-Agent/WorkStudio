import type { ListItem, ListSnapshot } from '../../../shared/lists';
import type { RouteCall } from '../../core/types';
import type { ListsService } from '../../service/lists';
import type { Router } from '../router';
import type { WorkspaceRef } from './shared';

// ─── lists ──────────────────────────────────────────────

interface ListActionInput {
  action?: string;
  item?: ListItem;
  itemType?: string;
  meta?: Record<string, unknown>;
}

export function routesLists(r: Router, service: ListsService): void {
  const sidebar = r.state<ListSnapshot>('/');

  const refresh = async (wsId: string): Promise<ListSnapshot> => {
    const snapshot = await service.snapshot();
    sidebar.publish({ wsId }, snapshot);
    return snapshot;
  };

  r.handle('/refresh', (call: RouteCall<null>) =>
    refresh(String(call.params['wsId'])),
  );
  r.handle('/action', (call: RouteCall<ListActionInput>) => {
    const input = call.input;
    const item = input.item ?? {
      key: '',
      itemType: input.itemType ?? '',
      title: '',
      meta: input.meta,
    };
    const wsId = String(call.params['wsId']);
    const meta = item.meta ?? {};

    if (item.itemType === 'document') {
      const ref = String(meta['ref'] ?? '');
      if (!ref) return { ok: true };
      return r.call(`/workspaces/${wsId}/resources/pages/open`, { ref });
    }

    if (item.itemType === 'settings') {
      const pageId = String(meta['pageId'] ?? '');
      if (!pageId) return { ok: true };
      return r.call('/settings/open', { pageId });
    }

    if (item.itemType === 'plugin') {
      const pluginId = String(meta['pluginId'] ?? '');
      if (!pluginId) return { ok: true };
      return r.call('/plugins/open', { pluginId });
    }

    if (item.itemType === 'session') {
      const path = String(meta['path'] ?? '');
      if (!path) return { ok: true };
      return r.call(`/workspaces/${wsId}/sessions/current/open`, {
        sessionId: encodeURIComponent(path),
      });
    }

    const viewId = String(meta['viewId'] ?? '');
    if (viewId) return r.call(`/views/${viewId}/activate`);

    return { ok: true };
  });

  r.on<WorkspaceRef | null>('/workspaces/current', (value) => {
    if (value?.id) void refresh(value.id);
  });
  r.on<{ id: string }>('/workspaces/closed', (value) => {
    sidebar.drop({ wsId: value.id });
  });
}
