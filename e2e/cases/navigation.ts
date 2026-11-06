import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'navigation.sidebar',
  title: '资料栏常驻，能力与设置在中央打开',
  tags: ['dev', 'ci'],
  async run(ctx) {
    for (const [entry, title] of [
      ['sidebar-nav-plugins', '文档插件'],
      ['sidebar-nav-settings', '外观与皮肤'],
    ]) {
      await ctx.clickTestId(entry);
      await ctx.expect.poll(
        async () =>
          (
            await ctx.appBridge.peek<Array<{ active: boolean; title: string }>>(
              '/views',
            )
          )?.some((view) => view.active && view.title === title) ?? false,
        '管理页面没有打开',
      );
      await ctx.expect.text('sidebar', '工作区资料');
      await ctx.expect.visible('sidebar-find-input');
    }
  },
});
