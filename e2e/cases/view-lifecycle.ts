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
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    await ctx.waitForPage(/pages\/settings\/index\.html/);

    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return views?.some((view) => view.title === '设置') ?? false;
    }, '设置视图未出现在视图列表');
    const view = (await ctx.legacyBridge.peek<ViewInfo[]>('/views'))?.find(
      (item) => item.title === '设置',
    );
    if (!view) throw new Error('设置视图不存在');

    await ctx.legacyBridge.call(`/views/${view.id}/close`);
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return !(views ?? []).some((item) => item.id === view.id);
    }, '关闭视图后标签仍存在');
  },
});
