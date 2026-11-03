import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'navigation.sidebar',
  title: '侧栏在资源 / 插件 / 设置之间切换',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('sidebar-nav-plugins');
    await ctx.expect.attribute('sidebar-nav-plugins', 'data-active', 'true');

    await ctx.clickTestId('sidebar-nav-settings');
    await ctx.expect.attribute('sidebar-nav-settings', 'data-active', 'true');

    await ctx.clickTestId('sidebar-nav-resources');
    await ctx.expect.attribute('sidebar-nav-resources', 'data-active', 'true');
  },
});
