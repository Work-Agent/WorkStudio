/**
 * App 的 protocols：页面地址 → 页面文件 + scheme 注册。
 *
 * `work://` 走固定路由表，`plugin://` 走插件表加路径白名单；
 * host 不单独注册，安装插件加一条、卸载删一条。
 */

import { dirname, join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol, type Session } from 'electron';
import { existsSync } from 'node:fs';
import { parsePluginUrl, parseWorkUrl } from '../shared/pages.ts';
import { injectThemeGate } from '../shared/appearance.ts';
import type { PluginPackage } from './plugin/manifest.ts';

/** 系统页：work://studio/<page>。 */
const SYSTEM_PAGES = new Set([
  'shell',
  'assistant',
  'overlay',
  'capture',
  'welcome',
  'settings',
  'snapshot',
]);

const ASSET_EXT =
  /\.(html|js|mjs|css|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|map)$/i;

const PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
} as const;

export interface PluginPageEntry {
  id: string;
  label: string;
  root: string;
  content: string;
  settings?: string;
}

type Resolution = { file: string } | { proxy: string } | null;

export class Protocols {
  private readonly plugins = new Map<string, PluginPageEntry>();

  constructor(
    private readonly rendererRoot: string,
    private readonly devBase?: string,
  ) {}

  systemPages(): string[] {
    return [...SYSTEM_PAGES];
  }

  registerPlugin(pkg: PluginPackage): void {
    this.plugins.set(pkg.manifest.id, {
      id: pkg.manifest.id,
      label: pkg.manifest.label ?? pkg.manifest.id,
      root: pkg.root,
      content: pkg.contentPage,
      ...(pkg.settingsPage ? { settings: pkg.settingsPage } : {}),
    });
  }

  unregisterPlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  plugin(pluginId: string): PluginPageEntry | null {
    return this.plugins.get(pluginId) ?? null;
  }

  list(): PluginPageEntry[] {
    return [...this.plugins.values()];
  }

  resolve(value: string): Resolution {
    const work = parseWorkUrl(value);
    if (work) return this.system(work.page, work.rest);
    const plugin = parsePluginUrl(value);
    if (plugin) return this.pluginPage(plugin.id, plugin.kind, plugin.rest);
    return null;
  }

  private system(page: string, rest: string[]): Resolution {
    // 渲染层入口页的静态资源与 favicon 都走这里。
    if (!SYSTEM_PAGES.has(page)) {
      return this.asset([page, ...rest].join('/'));
    }
    if (rest[0] === 'assets') {
      return this.asset(['assets', ...rest.slice(1)].join('/'));
    }
    return this.entry(`pages/${page}/index.html`);
  }

  private entry(path: string): Resolution {
    return this.devBase
      ? { proxy: `${this.devBase}/${path}` }
      : { file: join(this.rendererRoot, path) };
  }

  private asset(tail: string): Resolution {
    if (!ASSET_EXT.test(tail)) return null;
    if (this.devBase) return { proxy: `${this.devBase}/${tail}` };
    const file = normalize(join(this.rendererRoot, tail));
    return isWithin(this.rendererRoot, file) ? { file } : null;
  }

  private pluginPage(
    pluginId: string,
    kind: string,
    rest: string[],
  ): Resolution {
    const entry = this.plugins.get(pluginId);
    if (!entry) return null;

    if (kind === 'content' && rest.length === 0) {
      return { file: entry.content };
    }
    if (kind === 'settings' && rest.length === 0) {
      return entry.settings ? { file: entry.settings } : null;
    }
    if (kind === 'assets' && rest.length > 0) {
      const tail = rest.join('/');
      // 页面入口既可能自带 assets 目录，也可能用构建器拆到上一级 assets。
      const candidates = [
        join(dirname(entry.content), 'assets', tail),
        join(dirname(entry.content), '..', 'assets', tail),
        join(entry.root, 'assets', tail),
        join(entry.root, 'dist', 'assets', tail),
      ];
      const file = candidates
        .map((candidate) => normalize(candidate))
        .find((candidate) => existsSync(candidate));
      return file && isWithin(entry.root, file) ? { file } : null;
    }

    const page =
      kind === 'settings' ? (entry.settings ?? entry.content) : entry.content;
    const tail =
      kind === 'content' || kind === 'settings'
        ? rest.join('/')
        : [kind, ...rest].join('/');
    if (!tail || !ASSET_EXT.test(tail)) return null;
    const file = normalize(join(dirname(page), tail));
    return isWithin(entry.root, file) ? { file } : null;
  }
}

let schemesRegistered = false;

/** 进程启动、ready 之前调用一次；重复调用安全。 */
export function registerSchemes(): void {
  if (schemesRegistered) return;
  schemesRegistered = true;
  protocol.registerSchemesAsPrivileged([
    { scheme: 'work', privileges: PRIVILEGES },
    { scheme: 'plugin', privileges: PRIVILEGES },
  ]);
}

/** 每个 session 注册一次协议处理器（系统页与插件页共用一张表）。 */
export function serveProtocols(target: Session, protocols: Protocols): void {
  for (const scheme of ['work', 'plugin'] as const) {
    target.protocol.handle(scheme, (request) => serve(request.url, protocols));
  }
}

async function serve(url: string, protocols: Protocols): Promise<Response> {
  const resolved = protocols.resolve(url);
  if (!resolved) return notFound();
  try {
    if ('proxy' in resolved) return await net.fetch(resolved.proxy);
    const fileUrl = pathToFileURL(resolved.file).toString();
    // HTML 首帧底色：系统页（构建产物）与插件页都要，避免深色模式白闪。
    if (/\.html?$/i.test(resolved.file)) {
      const response = await net.fetch(fileUrl);
      if (!response.ok) return response;
      return new Response(injectThemeGate(await response.text()), {
        status: response.status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return await net.fetch(fileUrl);
  } catch {
    return notFound();
  }
}

function isWithin(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
