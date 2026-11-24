import type { PluginSurface } from './plugins.ts';
import type { ResourcesRuntime } from './resources.ts';
import type { ResourcesService } from './resources/service.ts';
import { appPageUrl } from '../shell/app-paths.ts';
import type { Views } from '../shell/views.ts';

interface ViewOptions {
  rendererPage?: (
    page: 'index' | 'assistant' | 'overlay' | 'settings' | 'welcome',
  ) => string;
  preloads?: {
    extension?: string;
    browser?: string;
    assistant?: string;
    overlay?: string;
    settings?: string;
  };
}

export interface AppProviderDeps {
  options: ViewOptions;
  ensureResources(): Promise<ResourcesRuntime>;
  resources(): ResourcesService | null;
}

/** 把内容视图的打开契约注册到 Views；App 不持有 provider 细节。 */
export function registerAppProviders(
  views: Views,
  deps: AppProviderDeps,
): void {
  views.provide({
    type: 'resource',
    owner: 'resources',
    resolve: async (target) => {
      if (target.type !== 'resource') throw new Error('unexpected target');
      const runtime = await deps.ensureResources();
      const result = await runtime.service.openPage(target.ref);
      if (result.type === 'browser') {
        return {
          type: 'web',
          url: result.url,
          title: result.url,
          preload: deps.options.preloads?.browser,
        };
      }
      const info = result.info;
      if (!info.page) {
        runtime.service.closePage(info.id);
        throw new Error(`无可用查看器：${target.ref}`);
      }
      const name = decodeURIComponent(info.ref.split('/').pop() ?? info.ref);
      return {
        type: 'page',
        url: `${appPageUrl(info.page)}?session=${info.id}`,
        title: name,
        contentPath: `resource:${info.ref}`,
        sessionId: info.id,
        preload: deps.options.preloads?.extension,
      };
    },
    release: (contentPath) => {
      if (!contentPath.startsWith('resource:')) return;
      for (const page of deps.resources()?.pages() ?? []) {
        if (page.ref === contentPath.slice('resource:'.length)) {
          deps.resources()?.closePage(page.id);
          return;
        }
      }
    },
    refresh: (contentPath) => {
      if (!contentPath.startsWith('resource:')) return;
      const page = deps
        .resources()
        ?.pages()
        .find((item) => item.ref === contentPath.slice('resource:'.length));
      if (page) void deps.resources()?.reloadPage(page.id);
    },
  });

  views.provide({
    type: 'web',
    owner: 'browser',
    resolve: (target) => {
      if (target.type !== 'web') throw new Error('unexpected target');
      return {
        type: 'web',
        url: target.url,
        title: target.title ?? target.url,
        preload: deps.options.preloads?.browser,
        reuseKey: `web:${target.url}`,
      };
    },
  });

  views.provide({
    type: 'welcome',
    owner: 'welcome',
    resolve: () => {
      const base = deps.options.rendererPage?.('welcome');
      if (!base) throw new Error('welcome renderer is unavailable');
      return {
        type: 'page',
        url: base,
        title: '欢迎',
        contentPath: '/welcome',
        preload: deps.options.preloads?.settings,
      };
    },
  });

  views.provide({
    type: 'settings',
    owner: 'settings',
    resolve: (target) => {
      if (target.type !== 'settings') throw new Error('unexpected target');
      const base = deps.options.rendererPage?.('settings');
      if (!base) throw new Error('settings renderer is unavailable');
      return {
        type: 'page',
        url: base,
        title: '设置',
        contentPath: '/settings/page/home',
        preload: deps.options.preloads?.settings,
      };
    },
  });

  views.provide({
    type: 'plugin',
    owner: 'plugins',
    resolve: async (target) => {
      if (target.type !== 'plugin') throw new Error('unexpected target');
      const runtime = await deps.ensureResources();
      const entry = runtime.ura.host.getPage(target.pluginId);
      if (!entry) throw new Error(`未知插件：${target.pluginId}`);
      const surface: PluginSurface =
        target.surface === 'page' ? 'page' : 'settings';
      const file = surface === 'settings' ? entry.settings : entry.page;
      if (!file)
        throw new Error(
          `插件没有${surface === 'settings' ? '配置页' : '页面'}：${target.pluginId}`,
        );
      return {
        type: 'page',
        url: appPageUrl(file),
        title: surface === 'settings' ? `${entry.label} 设置` : entry.label,
        contentPath: `/plugins/${surface === 'settings' ? 'settings' : 'page'}/${entry.id}`,
        preload: deps.options.preloads?.extension,
      };
    },
  });
}
