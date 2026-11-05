import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  title: string;
  active: boolean;
}

/**
 * 插件行的入口语义：点插件 = 打开**配置页**，不是文档查看器的渲染页。
 *
 * 渲染页（index.html）是资源管道的表现层出口，必须带文档内容与页面会话；
 * 单独打开它只会得到一张空白页（历史回归点）。
 */
export default defineCase({
  id: 'plugin.entry',
  title: '侧栏插件行打开插件配置页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('sidebar-nav-plugins');
    await ctx.clickText('HTML 阅读器', { exact: true });

    const page = await ctx.waitForPage(/html-viewer\/settings\.html/);
    await ctx.expect.poll(
      async () => (await page.text('body')).includes('.html'),
      '插件配置页没有渲染出内容',
    );

    await ctx.expect.poll(async () => {
      const views = await ctx.appBridge.peek<ViewInfo[]>('/views');
      return (
        views?.some(
          (view) => view.active && view.title === 'HTML 阅读器 设置',
        ) ?? false
      );
    }, '标签标题不是「HTML 阅读器 设置」');

    // 同一插件不应因这次点击多开一个渲染页（page 出口只由资源打开）。
    const urls = await ctx.windowUrls();
    if (urls.some((url) => /html-viewer\/index\.html/.test(url))) {
      throw new Error('插件行打开了文档渲染页');
    }
  },
});
