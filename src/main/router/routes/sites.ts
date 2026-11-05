import type { BrowserSnapshot } from '../../harness/browser-contract';
import type { RouteCall } from '../../core/types';
import type { SiteEntryView, SitesService } from '../../service/sites';
import type { Router } from '../router';
import type { WorkspaceRef } from './shared';

// ─── sites ──────────────────────────────────────────────

export function routesSites(r: Router, service: SitesService): void {
  const sites = r.state<SiteEntryView[]>('/');
  const allowlist = r.state<string[]>('/allowlist');
  const urls = new Map<string, { url: string; title: string }>();
  let seq = 0;

  const publish = (wsId: string): void => {
    sites.publish({ wsId }, service.sites(wsId));
    allowlist.publish({ wsId }, service.allowlist(wsId));
  };
  service.onChange(publish);

  r.handle('/allowlist/set', (call: RouteCall<{ list: string[] }>) => ({
    list: service.setAllowlist(String(call.params['wsId']), call.input.list),
  }));
  r.handle('/capture', async (call: RouteCall<{ page: BrowserSnapshot }>) => {
    const captured = await service.capture(call.input.page);
    if (captured) publish(String(call.params['wsId']));
    return captured;
  });
  r.handle('/refresh', (call: RouteCall<null>) => {
    publish(String(call.params['wsId']));
    return { ok: true };
  });
  r.handle(
    '/web/open',
    async (call: RouteCall<{ url: string; title?: string }>) => {
      const wsId = String(call.params['wsId']);
      const url = call.input.url;
      const title = (call.input.title ?? '').trim();
      // 同一 URL 已有网页标签则直接激活：站点条目是入口，不是副本
      const open =
        r.get<Array<{ id: string; type: string; url: string }>>('/views');
      const existing = open?.find(
        (view) => view.type === 'web' && view.url === url,
      );
      if (existing) {
        await r.call(`/views/${existing.id}/activate`);
        return { viewId: existing.id };
      }
      const webId = `web-${(seq += 1)}`;
      urls.set(webId, { url, title });
      const path = r.at('/web/:webId', { wsId, webId });
      const opened = await r.call<{ id: string }>('/views/open', { path });
      return { viewId: opened.id };
    },
  );

  r.view({
    path: '/workspaces/:wsId/sites/web/:webId',
    resolve: (call) => {
      const webId = String(call.params['webId']);
      const entry = urls.get(webId);
      if (!entry) throw new Error(`unknown web view ${webId}`);
      // 标签标题 = 页面标题（快照头部），地址栏仍展示 URL
      return {
        type: 'web',
        url: entry.url,
        title: entry.title || entry.url,
        grants: {},
      };
    },
    release: (path) => {
      urls.delete(path.split('/').pop() ?? '');
    },
  });

  r.on<WorkspaceRef | null>('/workspaces/current', (value) => {
    if (value?.id) publish(value.id);
  });
  r.on<{ id: string }>('/workspaces/closed', (value) => {
    sites.drop({ wsId: value.id });
    allowlist.drop({ wsId: value.id });
  });
}
