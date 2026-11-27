import { defineCase } from '../runner/contract.ts';
import { ensureBuiltinPlugin } from '../support/plugin-fixture.ts';

interface ViewInfo {
  title: string;
  active: boolean;
}

export default defineCase({
  id: 'plugin.entry',
  title: '设置卡片中的插件配置入口打开插件配置页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureBuiltinPlugin(ctx, 'text-editor');
    await ctx.legacyBridge.call('/plugins/open', {
      pluginId: 'text-editor',
      surface: 'settings',
    });
    const page = await ctx.waitForPage(/text-editor\/settings/);
    await page.expect.text('body', '自动换行');
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return (
        views?.some(
          (view) => view.active && view.title === '纯文本编辑器 设置',
        ) ?? false
      );
    }, '标签标题不是「纯文本编辑器 设置」');
  },
});
