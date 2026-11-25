/**
 * 插件网络：registry 与 zip 下载共用应用偏好里的代理。
 *
 * Node fetch 不支持 socks5；Electron 的 Session.fetch 走 Chromium 网络栈，
 * 能复用用户在偏好设置里配置的 http / socks 代理。
 */

import { session, type Session } from 'electron';
import { createLog } from '../log.ts';
import type { StorageLayout } from '../platform/paths.ts';
import { readUserPreferences } from '../platform/preferences.ts';

const log = createLog('plugin-network');

export type PluginFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

let pluginSession: Session | null = null;
let appliedProxy: string | null = null;

function sessionForPlugins(): Session {
  pluginSession ??= session.fromPartition('workstudio-plugin-network');
  return pluginSession;
}

export async function pluginFetch(
  layout: StorageLayout,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const proxy = readUserPreferences(layout).proxy;
  // 本地 registry fixture / 开发服务永远直连，避免代理环路。
  if (!proxy || isLoopbackHost(url)) return fetch(url, init);
  try {
    if (proxy !== appliedProxy) {
      await sessionForPlugins().setProxy({ proxyRules: proxy });
      appliedProxy = proxy;
    }
    return (await sessionForPlugins().fetch(
      url,
      init as Parameters<Session['fetch']>[1],
    )) as unknown as Response;
  } catch (error) {
    log.warn(
      `代理请求失败：${proxy} ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

function isLoopbackHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** 绑定数据根后的 fetcher；插件服务与 catalog 共用。 */
export function createPluginFetcher(layout: StorageLayout): PluginFetcher {
  return (url, init) => pluginFetch(layout, url, init);
}
