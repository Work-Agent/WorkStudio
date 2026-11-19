import { startDevRendererServer } from './dev-server.ts';

let close: (() => Promise<void>) | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env['E2E_DEV'] !== '1') return async () => {};
  const server = await startDevRendererServer();
  process.env['E2E_RENDERER_URL'] = server.url;
  close = server.close;
  return async () => {
    await close?.();
    close = null;
  };
}
