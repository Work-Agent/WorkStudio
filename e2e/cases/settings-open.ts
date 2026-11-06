import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.open',
  title: '通过 views.open 打开内置插件设置页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.appBridge.call('/settings/open', { pageId: 'plugins' });
    const page = await ctx.waitForPage(/settings\/plugins\/index\.html/);
    await page.expect.text('h1', '文档插件');
    await ctx.expect.poll(
      async () =>
        (await page.evaluate(() => typeof window.appBridge?.call)) ===
        'function',
      '设置页 appBridge 未就绪',
    );
  },
});
