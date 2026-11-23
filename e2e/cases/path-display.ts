import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'path.display',
  title: '设置地址显示逻辑地址而非本机路径',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    await ctx.expect.poll(
      async () => (await ctx.text('resource-url-bar'))?.startsWith('设置'),
      '设置页地址不是「设置 · 卡片名」',
    );
    const shown = await ctx.text('resource-url-bar');
    if (shown?.includes('/')) throw new Error(`地址泄漏了路径：${shown}`);
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await page.expect.text('h1', '设置');
  },
});
