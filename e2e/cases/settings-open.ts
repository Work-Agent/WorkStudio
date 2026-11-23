import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.open',
  title: '打开单页设置并渲染卡片',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await page.expect.text('h1', '设置');
    await page.expect.text('body', '外观与主题');
    await page.expect.text('body', '模型连接');
  },
});
