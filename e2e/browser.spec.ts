import { createServer } from 'node:http';
import { expect, test } from './app';
import { openBrowser } from './commands';
import { windowByUrl } from './fixtures';

test('打开临时浏览器视图', async ({ shell, electron }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>E2E Browser</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const url = `http://127.0.0.1:${address.port}/`;

  try {
    await openBrowser(shell, url);
    const page = await windowByUrl(
      electron.app,
      new RegExp(String(address.port)),
    );
    await expect(
      page.getByRole('heading', { name: 'E2E Browser' }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => typeof window.appBridge))
      .toBe('undefined');
  } finally {
    server.close();
  }
});
