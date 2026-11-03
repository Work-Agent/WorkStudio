/**
 * E2E dev renderer server：只启动 renderer 的 Vite dev server，
 * 主进程 / preload 仍用 electron-vite build 的产物。
 *
 * 这样 Playwright 能继续用 _electron.launch（可 evaluate 主进程），
 * 同时页面走 Vite HMR；不会有 electron-vite dev 自带的第二个 Electron 实例。
 */
import { resolveConfig } from 'electron-vite';
import { createServer, type ViteDevServer } from 'vite';

export interface DevRendererServer {
  url: string;
  close(): Promise<void>;
}

export async function startDevRendererServer(): Promise<DevRendererServer> {
  const { config } = await resolveConfig({}, 'serve', 'development');
  const renderer = config?.renderer;
  if (!renderer) throw new Error('renderer config is missing');

  const server: ViteDevServer = await createServer({
    ...renderer,
    configFile: false,
    server: {
      ...renderer.server,
      port: 0,
    },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    await server.close();
    throw new Error('dev renderer server has no local URL');
  }
  return {
    url,
    close: () => server.close(),
  };
}
