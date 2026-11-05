import type { UpdatesService } from '../../service/updates';
import { BUNDLED_GITHUB_TOKEN } from '../../plugins/github';
import type { Router } from '../router';

// ─── updates ────────────────────────────────────────────

export function routesUpdates(r: Router, service: UpdatesService): void {
  const status = r.state('/status');
  service.onChange(() => status.publish(service.status()));
  status.publish(service.status());

  // 内置只读 token：设置页输入框的默认值（用户配置优先，清空后回退此值）。
  r.state('/default-token').publish(BUNDLED_GITHUB_TOKEN);

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
