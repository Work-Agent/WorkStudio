import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.models',
  title: '设置模型卡片读取 agent 供应商与模型目录',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'models' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await ctx.expect.poll(async () => {
      const value = (await page.evaluate(async () => {
        const [providers, models] = await Promise.all([
          window.workStudio.subscribe('agent', 'providers'),
          window.workStudio.subscribe('agent', 'models'),
        ]);
        return {
          providers: Array.isArray(providers) ? providers.length : -1,
          models: Array.isArray(models) ? models.length : -1,
        };
      })) as { providers: number; models: number };
      return value.providers > 0 && value.models > 0;
    }, '模型资源为空');
  },
});
