import type { WorkspaceMeta } from '../../../shared/app';
import type { RouteCall } from '../../core/types';
import type { WorkspacesService } from '../../service/workspaces';
import type { Router } from '../router';

// ─── workspaces ─────────────────────────────────────────

export function routesWorkspaces(r: Router, service: WorkspacesService): void {
  const list = r.state<WorkspaceMeta[]>('/');
  const current = r.state<WorkspaceMeta | null>('/current');
  const closed = r.event<{ id: string }>('/closed');

  const publish = (): void => {
    list.publish(service.list);
    current.publish(service.current);
  };
  service.onChange(publish);
  service.onClose((id) => closed.emit({ id }));
  publish();

  r.handle('/refresh', () => service.refresh());
  r.handle('/open', (call: RouteCall<{ path: string }>) =>
    service.open(call.input.path),
  );
  r.handle('/close', () => {
    service.close();
    return { ok: true };
  });
  r.handle('/rename', (call: RouteCall<{ id: string; name: string }>) =>
    service.rename(call.input.id, call.input.name),
  );
  r.handle('/delete', (call: RouteCall<{ id: string }>) => {
    service.remove(call.input.id);
    return { ok: true };
  });
}
