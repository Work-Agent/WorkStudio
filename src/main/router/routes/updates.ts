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
}
