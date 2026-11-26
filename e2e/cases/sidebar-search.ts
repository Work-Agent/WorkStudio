import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'sidebar.search',
  title: '侧栏用两个独立按钮切换文件查找与内容搜索',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { sidebarCollapsed: false },
      });
    });

    await ctx.clickTestId('sidebar-nav-find');
    await ctx.expect.visible('[data-testid="sidebar-find"]');
    await ctx.expect.attribute('sidebar-nav-find', 'data-active', 'true');
    await ctx.expect.attribute('sidebar-nav-grep', 'data-active', 'false');

    await ctx.clickTestId('sidebar-nav-grep');
    await ctx.expect.visible('[data-testid="sidebar-grep"]');
    await ctx.expect.attribute('sidebar-nav-grep', 'data-active', 'true');
    await ctx.expect.attribute('sidebar-nav-find', 'data-active', 'false');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(
          () => !document.querySelector('[data-testid="sidebar-find"]'),
        ),
      '切换到内容搜索后仍显示文件查找',
    );

    await ctx.clickTestId('sidebar-nav-find');
    await ctx.expect.visible('[data-testid="sidebar-find"]');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(
          () => !document.querySelector('[data-testid="sidebar-grep"]'),
        ),
      '切换回文件查找后仍显示内容搜索',
    );

    await ctx.clickTestId('sidebar-nav-resources');
    await ctx.expect.attribute('sidebar-nav-resources', 'data-active', 'true');
  },
});
