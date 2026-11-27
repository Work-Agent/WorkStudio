import { defineCase } from '../runner/contract.ts';

/**
 * 侧栏只有一个搜索入口：文件 / 内容在面板内部切换；
 * 搜索面板与插件列表都能返回资源树。
 */
export default defineCase({
  id: 'sidebar.search',
  title: '侧栏搜索在面板内切换文件与内容，并可返回资源树',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { sidebarCollapsed: false },
      });
    });

    // 进入用例前先确保侧栏展开且停在资源树：视图是渲染层局部状态，
    // 上一个用例可能停在别的面板。
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(() =>
          Boolean(document.querySelector('[data-testid="sidebar-nav-search"]')),
        ),
      '侧栏未展开',
    );
    await ctx.clickTestId('sidebar-nav-search');
    await ctx.expect.visible('[data-testid="sidebar-search"]');
    await ctx.expect.attribute('sidebar-nav-search', 'data-active', 'true');

    // 检索模式是面板内部状态：先显式切到文件，再验证切换。
    await ctx.clickTestId('search-mode-files');
    await ctx.expect.visible('[data-testid="sidebar-find"]');
    await ctx.expect.attribute('search-mode-files', 'data-active', 'true');

    // 切换只在面板内部发生，导航上仍只有一个激活的搜索入口。
    await ctx.clickTestId('search-mode-content');
    await ctx.expect.visible('[data-testid="sidebar-grep"]');
    await ctx.expect.attribute('search-mode-content', 'data-active', 'true');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(
          () => !document.querySelector('[data-testid="sidebar-find"]'),
        ),
      '切到内容搜索后仍显示文件查找',
    );

    await ctx.clickTestId('sidebar-back');
    await ctx.expect.attribute('sidebar-nav-resources', 'data-active', 'true');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(
          () => !document.querySelector('[data-testid="sidebar-search"]'),
        ),
      '返回后搜索面板仍然显示',
    );

    // 插件列表也要有同一条返回路径。
    await ctx.clickTestId('sidebar-nav-plugins');
    await ctx.expect.visible('[data-testid="plugin-registry"]');
    await ctx.clickTestId('sidebar-back');
    await ctx.expect.attribute('sidebar-nav-resources', 'data-active', 'true');
  },
});
