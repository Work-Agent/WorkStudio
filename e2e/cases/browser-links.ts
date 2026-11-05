import { createServer } from 'node:http';
import { defineCase } from '../runner/contract.ts';

/**
 * 网页标签的导航归属：
 *   ① 页面内链接 → 留在本视图（不离开应用）
 *   ② target=_blank / window.open → 浏览器面临时标签（不落系统浏览器）
 */
export default defineCase({
  id: 'browser.links',
  title: '网页内跳转留在应用内，新窗口开临时标签',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const page = (name: string) =>
      `<html><body><h1 id="page">${name}</h1>` +
      `<a id="same" href="/same">same</a>` +
      `<a id="blank" href="/popup" target="_blank">blank</a>` +
      `</body></html>`;
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const path = (req.url ?? '/').split('?')[0];
      res.end(page(path === '/' ? 'HOME' : path.slice(1).toUpperCase()));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('no address');
    }
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const workspace = await ctx.appBridge.peek<{ id: string }>(
        '/workspaces/current',
      );
      if (!workspace) throw new Error('workspace not ready');
      await ctx.appBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
        url: `${origin}/`,
      });

      const home = await ctx.waitForPage(new RegExp(String(address.port)));
      await home.expect.text('#page', 'HOME');

      // ① 同视图跳转：地址变化但页面仍在应用内
      await home.evaluate(() => document.getElementById('same')?.click());
      await ctx.expect.poll(
        async () => (await home.evaluate(() => location.pathname)) === '/same',
        '页面内链接应在本视图内导航',
      );
      await home.expect.text('#page', 'SAME');

      // ② 新窗口：落到浏览器面的临时标签，原标签保持不动
      await home.evaluate(() => document.getElementById('blank')?.click());
      const popup = await ctx.waitForPage(/\/popup/);
      await popup.expect.text('#page', 'POPUP');
      await ctx.expect.poll(
        async () => (await home.evaluate(() => location.pathname)) === '/same',
        '新窗口不应替换原标签',
      );
    } finally {
      server.close();
    }
  },
});
