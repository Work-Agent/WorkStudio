import { createServer } from 'node:http';
import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'browser.open',
  title: '打开临时浏览器视图',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>E2E Browser</h1></body></html>');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('no address');
    }
    const url = `http://127.0.0.1:${address.port}/`;

    try {
      const workspace = await ctx.appBridge.peek<{ id: string }>(
        '/workspaces/current',
      );
      if (!workspace) throw new Error('workspace not ready');
      await ctx.appBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
        url,
      });

      const page = await ctx.waitForPage(new RegExp(String(address.port)));
      await page.expect.text('h1', 'E2E Browser');
      await ctx.expect.poll(
        async () =>
          (await page.evaluate(() => typeof window.appBridge)) === 'undefined',
        '浏览器页不应暴露 appBridge',
      );
    } finally {
      server.close();
    }
  },
});
