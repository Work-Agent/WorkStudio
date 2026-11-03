import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  title: string;
  active: boolean;
}

export default defineCase({
  id: 'view.tabs',
  title: '标签栏显示多个视图并可激活标签',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.appBridge.call('/settings/open', { pageId: 'plugins' });
    await ctx.appBridge.call('/settings/open', { pageId: 'models' });

    await ctx.expect.poll(async () => {
      const views = await ctx.appBridge.peek<ViewInfo[]>('/views');
      return (views?.length ?? 0) >= 2;
    }, '打开两个设置页后标签数不足');
    await ctx.expect.text('doc-tabs', '插件');
    await ctx.expect.text('doc-tabs', '模型配置');

    await ctx.clickTitle('模型配置');
    await ctx.expect.poll(async () => {
      const views = await ctx.appBridge.peek<ViewInfo[]>('/views');
      return views?.find((view) => view.active)?.title === '模型配置';
    }, '点击标签后模型配置未激活');
  },
});
