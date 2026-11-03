import { RouteFailure } from '../../core/failure';
import { appPageUrl } from '../../core/paths';
import type { RouteCall } from '../../core/types';
import type { StorageView } from '../../../shared/types';
import type { SettingsPageView, SettingsService } from '../../service/settings';
import type { Router } from '../router';

// ─── settings ───────────────────────────────────────────

export function routesSettings(r: Router, service: SettingsService): void {
  const pages = r.state<SettingsPageView[]>('/pages');
  const storage = r.state<StorageView>('/storage');

  const publish = (): void => {
    pages.publish(service.pages());
    storage.publish(service.storage());
  };
  publish();

  r.handle('/refresh', () => {
    publish();
    return { ok: true };
  });
  r.handle('/storage/open', async (call: RouteCall<{ path: string }>) => {
    await r.call('/native/open-path', { path: call.input.path });
    return null;
  });
  r.handle('/data-root/set', (call: RouteCall<{ path: string }>) => {
    service.setDataRoot(call.input.path);
    return { ok: true };
  });
  r.handle('/open', async (call: RouteCall<{ pageId: string }>) => {
    const target = service.page(call.input.pageId);
    if (!target) {
      throw new RouteFailure(
        'unknown',
        `unknown settings page: ${call.input.pageId}`,
      );
    }
    const path = r.at('/page/:pageId', { pageId: target.id });
    return r.call<{ id: string }>('/views/open', { path });
  });

  r.view({
    path: '/settings/page/:pageId',
    resolve: (call) => {
      const target = service.page(String(call.params['pageId']));
      if (!target) {
        throw new RouteFailure(
          'unknown',
          `unknown settings page: ${call.params['pageId']}`,
        );
      }
      return {
        type: 'page',
        url: appPageUrl(target.page),
        title: target.label,
        preload: 'page',
        grants: {
          call: [
            '/settings/**',
            '/plugins/**',
            '/piconf/**',
            '/workspaces/**',
            '/native/**',
          ],
          watch: [
            '/settings/pages',
            '/plugins/installed',
            '/plugins/catalog',
            '/piconf',
            '/workspaces/**',
          ],
        },
      };
    },
  });
}
