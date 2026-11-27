import { createServer } from 'node:http';
import { defineCase } from '../runner/contract.ts';

/**
 * 站点采集：sitemap + 页面链接发现页树，按「最多页数」截断后逐页抓取。
 * 页序：种子页 → sitemap → 页面链接。
 */
export default defineCase({
  id: 'snapshots.crawl',
  title: '站点采集按 sitemap 与链接发现页面并遵守页数上限',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    let origin = '';
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      const send = (html: string, type = 'text/html; charset=utf-8'): void => {
        res.writeHead(200, { 'content-type': type });
        res.end(html);
      };
      if (path === '/robots.txt') {
        send(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain');
        return;
      }
      if (path === '/sitemap.xml') {
        send(
          `<?xml version="1.0"?><urlset><url><loc>${origin}/c</loc></url></urlset>`,
          'application/xml',
        );
        return;
      }
      const title =
        path === '/a'
          ? '页面 A'
          : path === '/b'
            ? '页面 B'
            : path === '/c'
              ? '页面 C'
              : '站点首页';
      const links = path === '/' ? '<a href="/a">A</a><a href="/b">B</a>' : '';
      // 渲染后才出现的链接：只能从采集到的那一页 DOM 里发现。
      const script =
        path === '/'
          ? `<script>const d=document.createElement('a');d.href='/d';d.textContent='D';document.querySelector('article').appendChild(d)</script>`
          : '';
      // /c 故意没有 <title>：标题要回落到 h1。
      const head = path === '/c' ? '' : `<title>${title}</title>`;
      send(
        `<!doctype html><html><head>${head}</head><body><article><h1>${title}</h1><p>正文。</p>${links}</article>${script}</body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('no address');
    }
    origin = `http://127.0.0.1:${address.port}`;

    try {
      const result = await ctx.evaluate(async (seed) => {
        const response = await window.workStudio.command(
          'web',
          'web',
          'crawl',
          { url: seed as string, max: 5 },
        );
        if (!response.ok) throw new Error(response.error.message);
        return response.data as { captured: number };
      }, `${origin}/`);
      if (result.captured !== 5) {
        throw new Error(`采集页数不对：${result.captured}`);
      }

      await ctx.expect.poll(
        async () =>
          ctx.evaluate(async (base) => {
            const response = await window.workStudio.command(
              'web',
              'web',
              'list',
              {},
            );
            if (!response.ok) return false;
            const items = response.data as Array<{ url: string }>;
            const mine = items
              .filter((item) => item.url.startsWith(base as string))
              .map((item) => item.url.replace(base as string, ''));
            // 种子页 + sitemap 页 + 一个链接页；第三页由页数上限截掉。
            // /a /b 来自页内链接，/c 来自 sitemap，/d 只有渲染后才有。
            return ['/', '/a', '/b', '/c', '/d'].every((path) =>
              mine.includes(path),
            );
          }, origin),
        '站点快照没有按 sitemap 与链接发现',
      );

      // 没有 <title> 的页面用 h1 兜底，文件头部不会空。
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(async (base) => {
            const list = await window.workStudio.command(
              'web',
              'web',
              'list',
              {},
            );
            if (!list.ok) return false;
            const entry = (
              list.data as Array<{ url: string; ref: string }>
            ).find((item) => item.url === `${base}/c`);
            if (!entry) return false;
            const items = (await window.workStudio.read(
              entry.ref,
            )) as unknown as Array<{ text?: string }>;
            const head = items[0]?.text ?? '';
            return head.includes('title: "页面 C"');
          }, origin),
        '没有 title 的页面没有回落到 h1',
      );

      // 清空后再用较小的上限采一次：证明「最多页数」真的截断。
      await ctx.evaluate(async () => {
        await window.workStudio.command('web', 'web', 'removeSite', {
          domain: '127.0.0.1',
        });
      });
      const limited = await ctx.evaluate(async (seed) => {
        const response = await window.workStudio.command(
          'web',
          'web',
          'crawl',
          { url: seed as string, max: 2 },
        );
        if (!response.ok) throw new Error(response.error.message);
        return response.data as { captured: number };
      }, `${origin}/`);
      if (limited.captured !== 2) {
        throw new Error(`页数上限没有生效：${limited.captured}`);
      }
    } finally {
      server.close();
    }
  },
});
