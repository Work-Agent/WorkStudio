import { createServer } from 'node:http';
import { defineCase } from '../runner/contract.ts';

/**
 * 站点条目的打开语义：同一 URL 只保留一个网页标签，标签标题取页面标题。
 * 列表行的标题 / 网址来自快照头部，这里只覆盖「打开」这一跳。
 */
export default defineCase({
  id: 'site.open',
  title: '站点条目打开实时网页并按 URL 复用标签',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>E2E Site</h1></body></html>');
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
    const title = 'E2E 站点页面';

    try {
      const workspace = await ctx.legacyBridge.peek<{ id: string }>(
        '/workspaces/current',
      );
      if (!workspace) throw new Error('workspace not ready');
      const open = `/workspaces/${workspace.id}/sites/web/open`;

      const first = await ctx.legacyBridge.call<{ viewId: string }>(open, {
        url,
        title,
      });
      const second = await ctx.legacyBridge.call<{ viewId: string }>(open, {
        url,
        title,
      });
      if (first.viewId !== second.viewId) {
        throw new Error(
          `同一 URL 重复打开产生了新标签：${first.viewId} vs ${second.viewId}`,
        );
      }

      const views =
        await ctx.legacyBridge.peek<
          Array<{ id: string; url: string; title: string }>
        >('/views');
      const view = (views ?? []).find((item) => item.id === first.viewId);
      if (!view) throw new Error('站点视图未出现在 /views');
      if (view.url !== url) throw new Error(`视图 URL 不符：${view.url}`);
      if (view.title !== title) {
        throw new Error(`标签标题不是页面标题：${view.title}`);
      }

      const page = await ctx.waitForPage(new RegExp(String(address.port)));
      await page.expect.text('h1', 'E2E Site');
      await ctx.legacyBridge.call(`/views/${first.viewId}/close`);
    } finally {
      server.close();
    }
  },
});
