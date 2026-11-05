import { RouteFailure } from '../../core/failure';
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

    if (item.itemType === 'web-page') {
      // 站点页面：直接交回实时视图（真实网页），快照 Markdown 只服务侧车
      const url = String(meta['url'] ?? '');
      if (!url) return { ok: true };
      return r.call(`/workspaces/${wsId}/sites/web/open`, {
        url,
        title: item.title,
      });
    }

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
      // 插件行是「配置入口」：只开配置页。渲染页是文档查看器出口（带文档、带页面
      // 会话），单独打开没有内容可渲染，因此缺配置页的插件不提供此入口。
      if (meta['hasConfig'] !== true) {
        throw new RouteFailure(
          'failed',
          `插件没有配置页：${pluginId}（仅作为文档查看器）`,
        );
      }
      return r.call('/plugins/open', { pluginId, surface: 'settings' });
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
