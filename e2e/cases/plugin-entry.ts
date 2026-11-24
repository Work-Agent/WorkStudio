import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface ViewInfo {
  title: string;
  active: boolean;
}

export default defineCase({
  id: 'plugin.entry',
  title: '设置卡片中的插件配置入口打开插件配置页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.legacyBridge.call('/plugins/open', {
      pluginId: 'html-viewer',
      surface: 'settings',
    });
    const page = await ctx.waitForPage(/html-viewer/);
    await page.expect.text('body', '.html');
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return (
        views?.some(
          (view) => view.active && view.title === 'HTML 阅读器 设置',
        ) ?? false
      );
    }, '标签标题不是「HTML 阅读器 设置」');
  },
});
