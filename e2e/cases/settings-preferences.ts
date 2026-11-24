import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.preferences',
  title: '全局偏好可写入并读取',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'preferences' });
    await ctx.evaluate(async () => {
      await window.workStudio.command('settings', 'preferences', 'set', {
        locale: 'zh-CN',
        proxy: 'http://127.0.0.1:7890',
      });
    });
    await ctx.expect.poll(async () => {
      const value = (await ctx.evaluate(() =>
        window.workStudio.subscribe('settings', 'preferences'),
      )) as { locale?: string; proxy?: string };
      return (
        value.locale === 'zh-CN' && value.proxy === 'http://127.0.0.1:7890'
      );
    }, '偏好没有写入');
  },
});
