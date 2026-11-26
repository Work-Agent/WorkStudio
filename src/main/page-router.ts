/**
 * 业务页面目标 → 页面地址。
 *
 * shell 只负责开标签；这里决定系统页走 work://，插件页走 plugin://。
 * 资源页的插件归属由 PluginManager 提供，PageRouter 不解释 ref。
 */

import { pluginUrl, workUrl } from '../shared/pages.ts';
import type { Protocols } from './protocols.ts';
import type { PluginManager } from './plugin/manager.ts';

export type PageTarget =
  | { type: 'welcome'; workspaceId: string }
  | { type: 'settings'; workspaceId: string; pageId?: string }
  | {
      type: 'resource';
      workspaceId: string;
      ref: string;
      locator?: string;
    }
  | {
      type: 'plugin';
      workspaceId: string;
      pluginId: string;
      surface: 'content' | 'settings';
      ref?: string;
    }
  | { type: 'web'; workspaceId: string; url: string; title?: string };

export interface ResolvedPage {
  type: PageTarget['type'];
  url: string;
  title: string;
  /** 标签复用键：资源 ref、插件页地址或网页 URL。 */
  contentPath: string;
  ref?: string;
  locator?: string;
  pluginId?: string;
}

export interface PageRouterOptions {
  /** 资源页打开前登记 workspace/<wsId>/<ref>。 */
  openRef?: (ref: string, workspaceId: string) => void;
}

export class PageRouter {
  constructor(
    private readonly protocols: Protocols,
    private readonly plugins: PluginManager,
    private readonly options: PageRouterOptions = {},
  ) {}

  resolve(target: PageTarget): ResolvedPage {
    switch (target.type) {
      case 'welcome':
        return page('welcome', workUrl('welcome'), '欢迎');
      case 'settings': {
        const card =
          target.pageId && target.pageId !== 'home' ? target.pageId : undefined;
        return page(
          'settings',
          workUrl('settings', card),
          card ? `设置 · ${card}` : '设置',
          card ? `settings:${card}` : 'settings',
        );
      }
      case 'web':
        return {
          type: 'web',
          url: target.url,
          title: target.title ?? target.url,
          contentPath: `web:${target.url}`,
        };
      case 'plugin': {
        const plugin = this.plugins.plugin(target.pluginId);
        if (!plugin) throw new Error(`插件不存在：${target.pluginId}`);
        if (target.surface === 'settings') {
          return {
            type: 'plugin',
            url: pluginUrl(plugin.id, 'settings'),
            title: `${plugin.label} · 设置`,
            contentPath: `plugin:${plugin.id}:settings`,
            pluginId: plugin.id,
          };
        }
        const ref = target.ref ?? '';
        return {
          type: 'plugin',
          url: pluginUrl(plugin.id, 'content', { ref }),
          title: plugin.label,
          contentPath: `plugin:${plugin.id}:content:${ref}`,
          ref,
          pluginId: plugin.id,
        };
      }
      case 'resource': {
        const plugin = this.plugins.pluginOfRef(target.ref);
        if (!plugin) throw new Error(`没有插件认领资源：${target.ref}`);
        this.options.openRef?.(target.ref, target.workspaceId);
        return {
          type: 'resource',
          url: pluginUrl(plugin.id, 'content', {
            ref: target.ref,
            ...(target.locator ? { locator: target.locator } : {}),
          }),
          title: plugin.label,
          contentPath: `plugin:${plugin.id}:content:${target.ref}`,
          ref: target.ref,
          ...(target.locator ? { locator: target.locator } : {}),
          pluginId: plugin.id,
        };
      }
    }
  }

  /** 页面注册表当前投影；系统页来自 Protocols，插件页来自 page 表。 */
  pages(): Array<{ id: string; label: string }> {
    return this.protocols.list().map((entry) => ({
      id: entry.id,
      label: entry.label,
    }));
  }
}

function page(
  type: 'welcome' | 'settings',
  url: string,
  title: string,
  contentPath = url,
): ResolvedPage {
  return { type, url, title, contentPath };
}
