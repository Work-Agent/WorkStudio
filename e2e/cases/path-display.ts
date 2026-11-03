import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'path.display',
  title: '页面展示路径相对 app / 工作区',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const workspace = await ctx.currentWorkspacePath();

    await ctx.appBridge.call('/settings/open', { pageId: 'plugins' });
    await ctx.expect.poll(
      async () => (await ctx.text('resource-url-bar')) === 'settings://plugins',
      '设置页地址不是 settings://plugins',
    );

    await ctx.appBridge.call('/settings/open', { pageId: 'storage' });
    const page = await ctx.waitForPage(/settings\/storage\/index\.html/);
    await ctx.expect.poll(
      async () => (await page.text('body')).includes('app/'),
      '存储页未展示 app/ 路径',
    );

    const text = await page.text('body');
    if (workspace && text.includes(workspace)) {
      throw new Error(`存储页泄露完整工作区路径：${workspace}`);
    }
  },
});
