import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.appearance',
  title: '主题仅 light / dark / system，缩放百分比生效',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    const set = async (input: Record<string, unknown>): Promise<void> => {
      await page.evaluate(async (patch) => {
        await window.workStudio.command('shell', 'appearance', 'set', patch);
      }, input);
    };
    try {
      await set({ source: 'dark' });
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('shell', 'appearance'),
        )) as { theme?: string; source?: string };
        return value.theme === 'dark' && value.source === 'dark';
      }, '深色主题没有写入');
      await set({ source: 'light' });
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('shell', 'appearance'),
        )) as { theme?: string; source?: string };
        return value.theme === 'light' && value.source === 'light';
      }, '浅色主题没有写入');
      await set({ source: 'system', zoom: 1.25 });
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('shell', 'appearance'),
        )) as { source?: string; zoom?: number };
        return value.source === 'system' && value.zoom === 1.25;
      }, '缩放百分比没有写入');
    } finally {
      await set({ source: 'system', zoom: 1 });
    }
  },
});
