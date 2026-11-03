/** Electron session 策略：权限、app:// 页面服务、工作台 CSP。 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { net, type Session } from 'electron';

export function serveAppPages(
  target: Session,
  pageSessions: WeakSet<Session>,
): void {
  if (pageSessions.has(target)) return;
  pageSessions.add(target);
  target.protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'page') {
        return new Response('Not found', { status: 404 });
      }
      const file = decodeURIComponent(url.pathname);
      if (!file.startsWith('/') || !existsSync(file)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Internal error', { status: 500 });
    }
  });
}

export function hardenSession(
  target: Session,
  pageSessions: WeakSet<Session>,
): void {
  target.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  serveAppPages(target, pageSessions);
}

/** 壳层 CSP：只作用 file://；app:// 设置/插件页与浏览器页不套壳层 CSP。 */
export function applyShellCsp(target: Session, dev: boolean): void {
  if (dev) return;
  target.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('file:')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
        ],
      },
    });
  });
}
