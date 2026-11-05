/**
 * 全局下载代理（undici 调度器）：用户设置（workspaceStudio.proxy）优先，
 * 其次终端导出的 https_proxy / http_proxy，都没有则直连。
 *
 * 各下载方（插件 zip / 更新安装包）在请求前调用 ensureProxy()；
 * 代理地址变化时重建调度器，无需重启。
 */
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { createLogger } from '../log';

const log = createLogger('net-proxy');

let proxyReader: () => string | null = () => null;
let appliedProxyUrl: string | null = null;

/** 注入代理地址读取器（App 装配时调用一次）。 */
export function setProxySource(reader: () => string | null): void {
  proxyReader = reader;
}

/** 用户设置优先，其次环境变量（仅 HTTP 代理；socks 端口通常同服，改写协议即可用）。 */
export function ensureProxy(): void {
  const raw = (
    proxyReader() ??
    process.env.https_proxy ??
    process.env.HTTPS_PROXY ??
    process.env.http_proxy ??
    process.env.HTTP_PROXY ??
    ''
  )
    .trim()
    .replace(/^socks\d+:\/\//, 'http://');
  const desired = raw || null;
  if (desired === appliedProxyUrl) return;
  try {
    if (desired) {
      // H2 经代理易断流，锁定 HTTP/1.1；npm undici 的全局调度器不影响 Node 内建 fetch
      setGlobalDispatcher(new ProxyAgent({ uri: desired, allowH2: false }));
      log.info('download via proxy', desired);
    } else {
      setGlobalDispatcher(new Agent({ allowH2: false }));
    }
    appliedProxyUrl = desired;
  } catch (error) {
    log.warn('invalid proxy url, direct fetch', error);
  }
}
