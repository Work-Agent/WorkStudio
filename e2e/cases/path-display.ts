import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'path.display',
  title: '设置地址显示逻辑地址而非本机路径',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    await ctx.expect.poll(
      async () => (await ctx.text('resource-url-bar')) === 'settings://home',
      '设置页地址不是 settings://home',
    );
    const page = await ctx.waitForPage(/pages\/settings\/index\.html/);
    await page.expect.text('h1', '设置');
  },
});
