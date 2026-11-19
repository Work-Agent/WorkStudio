import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'navigation.sidebar',
  title: '资料栏常驻，设置入口在标题栏',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('titlebar-settings');
    await ctx.expect.poll(
      async () =>
        (
          await ctx.legacyBridge.peek<
            Array<{ active: boolean; title: string }>
          >('/views')
        )?.some((view) => view.active && view.title === '设置') ?? false,
      '设置页面没有打开',
    );
  },
});
