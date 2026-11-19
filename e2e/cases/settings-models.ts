import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.models',
  title: '设置模型卡片读取供应商与模型目录',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'models' });
    const page = await ctx.waitForPage(/pages\/settings\/index\.html/);
    await ctx.expect.poll(async () => {
      const count = await page.evaluate(async () => {
        const value = (await window.workStudio.subscribe(
          'settings',
          'models',
        )) as { providers?: unknown[]; catalog?: unknown[] };
        return (value.providers?.length ?? 0) + (value.catalog?.length ?? 0);
      });
      return count > 0;
    }, '模型资源为空');
  },
});
