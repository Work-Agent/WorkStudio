import { RouteFailure } from '../../core/failure';
import type { RouteCall } from '../../core/types';
import type { UpdatesService } from '../../service/updates';
import type { Router } from '../router';

// ─── updates ────────────────────────────────────────────

export function routesUpdates(r: Router, service: UpdatesService): void {
  const status = r.state('/status');
  service.onChange(() => status.publish(service.status()));
  status.publish(service.status());

  r.handle('/refresh', () => {
    status.publish(service.status());
    return { ok: true };
  });
  r.handle('/check', async () => {
    await service.check();
    return service.status();
  });
  r.handle('/download', async () => {
    await service.download();
    return service.status();
  });
  r.handle('/open', async (call: RouteCall<{ path?: string }>) => {
    const path = call.input.path ?? service.status().file;
    if (!path) throw new RouteFailure('failed', '还没有下载完成的安装包');
    await r.call('/native/open-path', { path });
    return null;
  });
}
