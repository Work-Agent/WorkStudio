import type { ListSnapshot } from '../../../shared/lists';
import type { RouteCall } from '../../core/types';
import type { ListsService } from '../../service/lists';
import type { Router } from '../router';
import type { WorkspaceRef } from './shared';

// ─── lists ──────────────────────────────────────────────

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
  r.handle(
    '/action',
    (call: RouteCall<{ itemType: string; meta?: Record<string, unknown> }>) => {
      const ref = String(call.input.meta?.['ref'] ?? '');
      const wsId = String(call.params['wsId']);
      if (call.input.itemType === 'document' && ref) {
        return r.call(`/workspaces/${wsId}/resources/pages/open`, { ref });
      }
      return { ok: true };
    },
  );

  r.on<WorkspaceRef | null>('/workspaces/current', (value) => {
    if (value?.id) void refresh(value.id);
  });
  r.on<{ id: string }>('/workspaces/closed', (value) => {
    sidebar.drop({ wsId: value.id });
  });
}
