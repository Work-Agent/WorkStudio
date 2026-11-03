import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.sidebar',
  title: '从侧栏设置列表点击打开设置页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('sidebar-nav-settings');
    await ctx.clickText('插件', { exact: true });
    await ctx.expect.poll(async () => {
      const views =
        await ctx.appBridge.peek<Array<{ title: string }>>('/views');
      return views?.some((view) => view.title === '插件') ?? false;
    }, '点击设置列表后插件页未打开');
  },
});
