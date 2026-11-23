/**
 * 页面协议：work:// 与 plugin:// 的解析与分发。
 *
 * 地址只带身份，磁盘路径在这里解析：
 *   work://studio/<page>[/<rest>]      → 渲染层产物（开发模式代理到 vite）
 *   plugin://<id>/content|settings     → 插件声明的页面入口
 *   plugin://<id>/<rest>               → 插件目录内的静态资源
 */

import { statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, type Session } from 'electron';
import { parsePluginUrl, parseWorkUrl } from '../../shared/pages.ts';

/** 系统页 → 渲染层入口目录。 */
const SYSTEM_DIRS: Record<string, string> = {
  shell: 'shell',
  assistant: 'assistant',
  overlay: 'overlay',
  welcome: 'welcome',
  settings: 'settings',
  capture: 'capture',
};

/** 插件页允许直接取用的静态资源后缀。 */
const ASSET_EXT =
  /\.(html|js|mjs|css|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|map)$/i;

export interface PluginPageEntry {
  root: string;
  page?: string;
  settings?: string;
}

export interface PageHostOptions {
  /** 渲染层产物目录。 */
  rendererRoot: string;
  /** 开发模式的 vite 地址；有值时页面与资源都代理过去。 */
  devBase?: string;
  /** 插件页查询；插件不存在或未装载时返回 null。 */
  plugin: (id: string) => PluginPageEntry | null;
}

type Resolution = { file: string } | { proxy: string } | null;

export class PageHost {
  constructor(private readonly options: PageHostOptions) {}

  /** 请求地址 → 本地文件或开发代理地址。 */
  resolve(value: string): Resolution {
    const work = parseWorkUrl(value);
    if (work) return this.system(work.page, work.rest);
    const plugin = parsePluginUrl(value);
    if (plugin) return this.plugin(plugin.id, plugin.kind, plugin.rest);
    return null;
  }

  private system(page: string, rest: string[]): Resolution {
    const dir = SYSTEM_DIRS[page];
    // 已知系统页：路径段是页面参数（如设置卡片），资源走 /assets/...。
    if (dir) {
      if (rest[0] !== 'assets') return this.entry(`pages/${dir}/index.html`);
      return this.asset(['assets', ...rest.slice(1)].join('/'));
    }
    // 其余路径都按渲染层静态资源解析。
    return this.asset([page, ...rest].join('/'));
  }

  private entry(path: string): Resolution {
    return this.options.devBase
      ? { proxy: `${this.options.devBase}/${path}` }
      : { file: join(this.options.rendererRoot, path) };
  }

  private asset(tail: string): Resolution {
    if (!ASSET_EXT.test(tail)) return null;
    if (this.options.devBase)
      return { proxy: `${this.options.devBase}/${tail}` };
    const file = normalize(join(this.options.rendererRoot, tail));
    return isWithin(this.options.rendererRoot, file) ? { file } : null;
  }

  private plugin(id: string, kind: string, rest: string[]): Resolution {
    const entry = this.options.plugin(id);
    if (!entry) return null;
    if (kind === 'content' && rest.length === 0)
      return entry.page ? { file: entry.page } : null;
    if (kind === 'settings' && rest.length === 0)
      return entry.settings ? { file: entry.settings } : null;
    // 页面里的相对资源：按页面入口目录解析。
    const page =
      kind === 'settings'
        ? (entry.settings ?? entry.page)
        : (entry.page ?? entry.settings);
    if (!page) return null;
    const rel =
      kind === 'content' || kind === 'settings'
        ? rest.join('/')
        : [kind, ...rest].join('/');
    if (!rel || !ASSET_EXT.test(rel)) return null;
    const file = normalize(join(dirname(page), rel));
    return isWithin(entry.root, file) ? { file } : null;
  }
}

/** 每个 scheme 注册一次协议处理器（同一 session 共用）。 */
export function servePages(target: Session, host: PageHost): void {
  served(target, new WeakSet(), 'work', host);
  served(target, new WeakSet(), 'plugin', host);
}

function served(
  target: Session,
  handled: WeakSet<Session>,
  scheme: 'work' | 'plugin',
  host: PageHost,
): void {
  if (handled.has(target)) return;
  handled.add(target);
  target.protocol.handle(scheme, async (request) => {
    const resolved = host.resolve(request.url);
    if (!resolved) return notFound();
    if ('proxy' in resolved) {
      try {
        return await net.fetch(resolved.proxy);
      } catch {
        return notFound();
      }
    }
    if (!isFile(resolved.file)) return notFound();
    try {
      return await net.fetch(pathToFileURL(resolved.file).toString());
    } catch {
      return notFound();
    }
  });
}

function isWithin(root: string, file: string): boolean {
  if (!isAbsolute(file)) return false;
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
