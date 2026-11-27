/**
 * 页面登录（loopback）：打开供应商登录页，等它 302 回本机回调。
 *
 * 与 pi 的大厂 OAuth 完全同构——回调落在主进程，凭证不经过页面 JS：
 *   1. 起一个 127.0.0.1 临时端口（登录结束即关闭）；
 *   2. 打开 `loginUrl?redirect_uri=…&state=…`；
 *   3. 等 `redirect_uri` 命中：校验 state，取 access_token / refresh_token / expires_in；
 *      90 秒等不到就失败退出，避免 UI 一直挂在登录中；
 *   4. 交给调用方写密钥库，页面只看到一句「登录完成」。
 *
 * 供应商侧只需要在登录成功后把 token（或 code + 可换取的接口）带回来。
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface PageLoginCredential {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface PageLoginOptions {
  providerId: string;
  loginUrl: string;
  openUrl(url: string): void | Promise<void>;
  notify(message: string): void;
  timeoutMs?: number;
}

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>登录完成</title>
<body style="font:14px/1.7 system-ui;padding:48px;text-align:center;background:Canvas;color:CanvasText">
<h2>登录完成</h2><p>凭证已交给 WorkStudio，可以关闭此页面。</p></body>`;

const FAILURE_HTML = `<!doctype html><meta charset="utf-8"><title>登录失败</title>
<body style="font:14px/1.7 system-ui;padding:48px;text-align:center">
<h2>登录失败</h2><p>授权信息不完整，请回到 WorkStudio 重试。</p></body>`;

export async function loginViaLoopback(
  options: PageLoginOptions,
): Promise<PageLoginCredential> {
  const state = randomUUID();
  const { server, port } = await listen();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const target = new URL(options.loginUrl);
  target.searchParams.set('redirect_uri', redirectUri);
  target.searchParams.set('state', state);

  try {
    options.notify(`在打开的授权页完成登录，完成后会自动回到应用`);
    await options.openUrl(target.href);
    return await waitForCallback(server, {
      state,
      timeoutMs: options.timeoutMs ?? 90_000,
    });
  } finally {
    server.close();
  }
}

function listen(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('回调端口启动失败'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function waitForCallback(
  server: Server,
  input: { state: string; timeoutMs: number },
): Promise<PageLoginCredential> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error('等待授权超时'));
    }, input.timeoutMs);

    const finish = (error: Error | null, value?: PageLoginCredential): void => {
      clearTimeout(timer);
      server.removeAllListeners('request');
      if (error) reject(error);
      else if (value) resolve(value);
    };

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const state = url.searchParams.get('state');
      if (state !== input.state) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(FAILURE_HTML);
        finish(new Error('回调 state 校验失败'));
        return;
      }
      const denied = url.searchParams.get('error');
      if (denied) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(FAILURE_HTML);
        finish(new Error(`授权被拒绝：${denied}`));
        return;
      }
      const credential = credentialOf(url);
      if (!credential) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(FAILURE_HTML);
        finish(new Error('回调缺少 access token'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(SUCCESS_HTML);
      finish(null, credential);
    });
  });
}

/** 兼容常见命名：access_token / accessToken / token / key。 */
function credentialOf(url: URL): PageLoginCredential | null {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  const accessToken = pick('access_token', 'accessToken', 'token', 'key');
  if (!accessToken) return null;
  const refreshToken = pick('refresh_token', 'refreshToken');
  const expiresRaw = pick('expires_in', 'expiresIn', 'expires');
  const expiresIn = expiresRaw ? Number(expiresRaw) : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn !== undefined && Number.isFinite(expiresIn)
      ? { expiresIn }
      : {}),
  };
}
