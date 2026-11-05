import { RouteFailure } from '../../core/failure';
import { appPageUrl } from '../../core/paths';
import type { RouteCall } from '../../core/types';
import type { Query, ReadOptions } from '../../../shared/ura';
import type { FindOptions, GrepOptions } from '../../ura/facade';
import type { PageSessionInfo } from '../../ura/page-sessions';
import type { ResourcesService } from '../../service/resources';
import type { Router } from '../router';
import { wsIdOf } from './shared';

// ─── resources ──────────────────────────────────────────

export function routesResources(r: Router, service: ResourcesService): void {
  const page = r.state<PageSessionInfo>('/pages/:pageId');

  const publishPages = (): void => {
    const wsId = wsIdOf(r);
    if (!wsId) return;
    for (const info of service.pages()) {
      page.publish({ wsId, pageId: info.id }, info);
    }
  };
  service.onPagesChange(publishPages);
  service.onResourceChange((ref) => {
    // 外部变化直接归约进页面状态；渲染层只订阅 page 状态，不接收 change 事件。
    for (const info of service.pages()) {
      if (info.ref === ref) void service.reloadPage(info.id).catch(() => {});
    }
  });
  r.on<{ id: string }>('/workspaces/closed', (value) => {
    for (const info of service.pages()) {
      page.drop({ wsId: value.id, pageId: info.id });
    }
  });

  r.handle('/read', (call: RouteCall<{ ref: string; options?: ReadOptions }>) =>
    service.read(call.input.ref, call.input.options),
  );
  r.handle(
    '/write',
    (call: RouteCall<{ ref: string; content: string | Uint8Array }>) =>
      service.write(call.input.ref, call.input.content),
  );
  r.handle(
    '/edit',
    (
      call: RouteCall<{
        ref: string;
        anchor: { start: number; end: number; expected?: string };
        content: string | Uint8Array;
      }>,
    ) => service.edit(call.input.ref, call.input.anchor, call.input.content),
  );
  r.handle('/ls', (call: RouteCall<{ ref: string }>) =>
    service.ls(call.input.ref),
  );
  r.handle(
    '/find',
    (call: RouteCall<{ pattern: string; options?: FindOptions }>) =>
      service.find(call.input.pattern, call.input.options),
  );
  r.handle(
    '/grep',
    (call: RouteCall<{ pattern: string; options?: GrepOptions }>) =>
      service.grep(call.input.pattern, call.input.options),
  );
  r.handle('/query', (call: RouteCall<{ ref: string; query: Query }>) =>
    service.query(call.input.ref, call.input.query),
  );
  r.handle('/tree', (call: RouteCall<{ ref: string; limit?: number }>) =>
    service.tree(call.input.ref, call.input.limit),
  );
  r.handle('/watch', (call: RouteCall<{ ref: string }>) => {
    service.watch(call.input.ref);
    return { ref: call.input.ref };
  });
  r.handle('/unwatch', (call: RouteCall<{ ref: string }>) => {
    service.unwatch(call.input.ref);
    return { ref: null };
  });

  r.handle('/pages/open', async (call: RouteCall<{ ref: string }>) => {
    const result = await service.openPage(call.input.ref);
    if (result.type === 'browser') return result;
    if (!result.info.page) {
      service.closePage(result.info.id);
      throw new RouteFailure('failed', `无可用查看器：${call.input.ref}`);
    }
    const path = r.at('/pages/:pageId', {
      ...call.params,
      pageId: result.info.id,
    });
    const opened = await r.call<{ id: string }>('/views/open', { path });
    return { type: 'page', pageId: result.info.id, viewId: opened.id };
  });
  r.handle('/pages/:pageId/get', (call: RouteCall<null>) => {
    const info = service.page(String(call.params['pageId']));
    if (!info) {
      throw new RouteFailure(
        'unknown',
        `unknown page ${String(call.params['pageId'])}`,
      );
    }
    return info;
  });
  r.handle(
    '/pages/:pageId/save',
    (call: RouteCall<{ content: string | Uint8Array }>) =>
      service.savePage(String(call.params['pageId']), call.input.content),
  );
  r.handle('/pages/:pageId/reload', (call: RouteCall<null>) =>
    service.reloadPage(String(call.params['pageId'])),
  );
  r.handle('/pages/:pageId/close', (call: RouteCall<null>) => {
    service.closePage(String(call.params['pageId']));
    return null;
  });

  r.view({
    path: '/workspaces/:wsId/resources/pages/:pageId',
    resolve: (call) => {
      const info = service.page(String(call.params['pageId']));
      if (!info)
        throw new Error(`unknown page ${String(call.params['pageId'])}`);
      if (!info.page) {
        throw new RouteFailure('failed', `无可用查看器：${info.ref}`);
      }
      return {
        type: 'page',
        url: `${appPageUrl(info.page)}?session=${info.id}`,
        title: info.ref,
        sessionId: info.id,
        content: () => service.pageContent(info.id),
        preload: 'page',
        grants: {
          call: [
            '/workspaces/:wsId/resources/pages/:pageId/**',
            '/notify',
            '/native/**',
          ],
          watch: ['/workspaces/:wsId/resources/pages/:pageId'],
        },
      };
    },
    release: (path) => service.closePage(path.split('/').pop() ?? ''),
  });
}
