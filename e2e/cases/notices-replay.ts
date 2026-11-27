import { defineCase } from '../runner/contract.ts';

/** 通知浮层的锚点：容器里每个子节点是一条提示。 */
const TOASTS = '[data-testid="toast-host"] > *';

export default defineCase({
  id: 'shell.notices.replay',
  title: '新打开的设置页不重播历史通知',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const ws = await ctx.evaluate(() => String(window.workStudio.workspaceId));
    const notices = `${ws}/notices`;
    // 先推两条「历史」通知再开页面：挂载前的事件不该在新页面里弹一遍。
    await ctx.evaluate(async (resource) => {
      for (const message of ['历史通知一', '历史通知二']) {
        await window.workStudio.command('shell', String(resource), 'notify', {
          level: 'info',
          message,
        });
      }
      await window.workStudio.command('settings', 'pages', 'open', {
        pageId: 'extensions',
      });
    }, notices);

    const page = await ctx.waitForPage(/settings\/extensions/);
    const count = (): Promise<number> =>
      page.evaluate(
        (selector) => document.querySelectorAll(String(selector)).length,
        TOASTS,
      );

    // 等浮层该出现的时间过去，仍然是 0 才算没重播。
    await new Promise((resolve) => setTimeout(resolve, 800));
    const replayed = await count();
    if (replayed !== 0) throw new Error(`历史通知被重播：${replayed} 条`);

    // 挂载后的事件照常出现，且只出现一条。
    await ctx.evaluate(async (resource) => {
      await window.workStudio.command('shell', String(resource), 'notify', {
        level: 'info',
        message: '实时通知',
      });
    }, notices);
    await ctx.expect.poll(
      async () => (await count()) === 1,
      '挂载后的通知没有出现',
    );

    // 清理：队列与页面都不留痕。
    await ctx.evaluate(async (resource) => {
      await window.workStudio.command('shell', String(resource), 'dismiss', {});
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
        'close',
        { id: 'settings:extensions' },
      );
    }, notices);
  },
});
