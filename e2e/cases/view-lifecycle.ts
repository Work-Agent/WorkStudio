import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
}

export default defineCase({
  id: 'view.lifecycle',
  title: '打开并关闭设置视图',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const pattern = /settings\/plugins\/index\.html/;
    await ctx.appBridge.call('/settings/open', { pageId: 'plugins' });
    await ctx.waitForPage(pattern);

    await ctx.expect.poll(async () => {
      const views = await ctx.appBridge.peek<ViewInfo[]>('/views');
      return views?.some((view) => view.title === '插件') ?? false;
    }, '设置视图未出现在视图列表');
    const view = (await ctx.appBridge.peek<ViewInfo[]>('/views'))?.find(
      (item) => item.title === '插件',
    );
    if (!view) throw new Error('设置视图不存在');

    await ctx.appBridge.call(`/views/${view.id}/close`);
    await ctx.expect.poll(async () => {
      const urls = await ctx.windowUrls();
      return urls.filter((url) => pattern.test(url)).length === 0;
    }, '关闭视图后设置页窗口仍存在');
  },
});
