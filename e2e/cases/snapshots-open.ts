import { createServer } from 'node:http';
import { defineCase } from '../runner/contract.ts';

const PAGE = `<!doctype html><html><head><title>E2E 快照</title></head><body>
<article><h1>季度报告</h1><p>正文第一段。</p><ul><li>收入</li><li>成本</li></ul></article>
</body></html>`;

/** 侧栏面板：列表在侧栏，中间只放快照正文。 */
export default defineCase({
  id: 'snapshots.panel',
  title: '网站快照清单在侧栏面板内展示',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.evaluate(async () => {
      const windowId = window.workStudio.workspaceId;
      if (!windowId) throw new Error('窗口未绑定工作区');
      await window.workStudio.command('shell', `${windowId}/layout`, 'scene', {
        patch: { sidebarCollapsed: false },
      });
    });
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(() =>
          Boolean(
            document.querySelector('[data-testid="sidebar-nav-snapshots"]'),
          ),
        ),
      '侧栏没有网站快照入口',
    );

    const before = await ctx.evaluate(async () => {
      const windowId = window.workStudio.workspaceId;
      const views = (await window.workStudio.subscribe(
        'shell',
        `${windowId}/views`,
      )) as Array<{ id: string }> | null;
      return (views ?? []).length;
    });

    await ctx.clickTestId('sidebar-nav-snapshots');
    await ctx.expect.visible('[data-testid="snapshots-panel"]');
    await ctx.expect.visible('[data-testid="snapshots-add"]');

    // 面板自带返回资源树的入口。
    await ctx.clickTestId('sidebar-back');
    await ctx.expect.visible('[data-testid="sidebar-tree-group"]');
    await ctx.clickTestId('sidebar-nav-snapshots');
    await ctx.expect.visible('[data-testid="snapshots-panel"]');

    // 快照面板是侧栏视图，不新开标签。
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async (count) => {
          const windowId = window.workStudio.workspaceId;
          const views = (await window.workStudio.subscribe(
            'shell',
            `${windowId}/views`,
          )) as Array<{ id: string }> | null;
          return (views ?? []).length === count;
        }, before),
      '打开快照面板不应新增标签',
    );

    // 底部新增按钮展开地址输入，空地址时采集不可用。
    await ctx.clickTestId('snapshots-add');
    await ctx.expect.visible('[data-testid="snapshots-url"]');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(() => {
          const button = document.querySelector<HTMLButtonElement>(
            '[data-testid="snapshots-capture"]',
          );
          return button !== null && button.disabled;
        }),
      '空地址时采集按钮应当禁用',
    );
  },
});

export const captureCase = defineCase({
  id: 'snapshots.capture',
  title: '采集网页写入缓存并在中间打开 Markdown 快照',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('no address');
    }
    const url = `http://127.0.0.1:${address.port}/report`;

    try {
      await ctx.evaluate(async (input) => {
        const windowId = window.workStudio.workspaceId;
        if (!windowId) throw new Error('窗口未绑定工作区');
        await window.workStudio.command('browser', `${windowId}/tabs`, 'open', {
          url: input as string,
        });
      }, url);

      // 等页面就绪：读到的文本包含 fixture 标题才采集。
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(async () => {
            const windowId = window.workStudio.workspaceId;
            const page = (await window.workStudio.command(
              'browser',
              `${windowId}/tabs`,
              'read',
              {},
            )) as { ok: boolean; data?: { text?: string } };
            return page.ok && (page.data?.text ?? '').includes('季度报告');
          }),
        '网页没有就绪',
      );

      const captured = await ctx.evaluate(async (target) => {
        const result = await window.workStudio.command(
          'web',
          'web',
          'capture',
          { url: target as string },
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.data as { ref: string };
      }, url);
      if (
        !captured.ref.startsWith('file://') ||
        !captured.ref.endsWith('.md')
      ) {
        throw new Error(`快照文件地址不对：${captured.ref}`);
      }

      // 文件资源树里出现同一个「域 → 页」分组：点页面走实时网页。
      await ctx.clickTestId('sidebar-nav-resources');
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(() => {
            // 每个站点一棵根树：组就是域名，页面直接挂在组下。
            const group = document.querySelector<HTMLElement>(
              '[data-testid="sidebar-tree-group"][data-group="sites:127.0.0.1"]',
            );
            if (!group?.parentElement) return false;
            const items = [
              ...group.parentElement.querySelectorAll<HTMLElement>(
                '[data-testid="sidebar-tree-item"]',
              ),
            ].map((node) => node.title);
            return items.includes('E2E 快照');
          }),
        '资源树没有站点根节点',
      );
      await ctx.evaluate(() => {
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="sidebar-tree-item"]',
          ),
        ];
        const target = nodes.find((node) => node.title === 'E2E 快照');
        target?.click();
      });
      const livePage = await ctx.waitForPage(new RegExp(String(address.port)));
      if (!livePage.url().includes('/report')) {
        throw new Error(`实时页地址不对：${livePage.url()}`);
      }

      // 侧栏面板里能点开这条快照（Markdown 正文）。
      await ctx.clickTestId('sidebar-nav-snapshots');
      await ctx.expect.visible('[data-testid="snapshots-list"]');
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(async (target) => {
            const result = await window.workStudio.command(
              'web',
              'web',
              'list',
              {},
            );
            if (!result.ok) return false;
            const items = result.data as Array<{ url: string }>;
            return items.some((item) => item.url === target);
          }, url),
        '快照没有进入清单',
      );

      await ctx.expect.poll(
        async () =>
          ctx.evaluate(() =>
            Boolean(
              document.querySelector(
                '[data-testid="snapshots-domain"][data-domain="127.0.0.1"]',
              ) && document.querySelector('[data-testid="snapshots-row-menu"]'),
            ),
          ),
        '面板没有按域名分组或缺少行操作',
      );
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(() =>
            Boolean(document.querySelector('[data-testid="snapshots-row"]')),
          ),
        '面板里没有快照条目',
      );
      await ctx.evaluate(() => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="snapshots-row"]')
          ?.click();
      });
      // 快照文件是 .md：条目打开后由 markdown 编辑器承接。
      const editorPage = await ctx.waitForPage(
        /^plugin:\/\/markdown-editor\/content/,
      );
      await ctx.expect.poll(async () => {
        const text = await editorPage.text('body');
        return text.includes('季度报告') && text.includes('收入');
      }, 'markdown 编辑器没有显示快照正文');

      // 快照文件本身带来源头部。
      const head = await ctx.evaluate(async (target) => {
        const items = (await window.workStudio.read(
          target as string,
        )) as unknown as Array<{ text?: string }>;
        return items[0]?.text ?? '';
      }, captured.ref);
      for (const part of [
        '---',
        'url: ',
        'title: ',
        'excerpt:',
        '## 可访问性结构',
      ]) {
        if (!head.includes(part)) {
          throw new Error(`快照文件缺少「${part}」：${head.slice(0, 160)}`);
        }
      }

      // 删除快照后清单不再包含它。
      await ctx.evaluate(async (target) => {
        const result = await window.workStudio.command('web', 'web', 'remove', {
          url: target as string,
        });
        if (!result.ok) throw new Error(result.error.message);
      }, url);
      await ctx.expect.poll(
        async () =>
          ctx.evaluate(async (target) => {
            const result = await window.workStudio.command(
              'web',
              'web',
              'list',
              {},
            );
            if (!result.ok) return false;
            const items = result.data as Array<{ url: string }>;
            return !items.some((item) => item.url === target);
          }, url),
        '快照没有被删除',
      );
    } finally {
      server.close();
    }
  },
});
