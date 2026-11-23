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
    await page.evaluate(() => {
      const card = document.querySelector('[data-page="appearance"]');
      (card?.querySelector('button') as HTMLButtonElement | undefined)?.click();
    });
    const setTheme = async (
      theme: 'light' | 'dark' | 'system',
    ): Promise<void> => {
      if (theme === 'dark') {
        await page.evaluate(async () => {
          await window.workStudio.command('settings', 'appearance', 'set', {
            theme: 'dark',
          });
        });
      } else if (theme === 'light') {
        await page.evaluate(async () => {
          await window.workStudio.command('settings', 'appearance', 'set', {
            theme: 'light',
          });
        });
      } else {
        await page.evaluate(async () => {
          await window.workStudio.command('settings', 'appearance', 'set', {
            theme: 'system',
          });
        });
      }
    };
    try {
      await setTheme('dark');
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('settings', 'appearance'),
        )) as { theme?: string };
        return value.theme === 'dark';
      }, '深色主题没有写入');
      await setTheme('light');
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('settings', 'appearance'),
        )) as { theme?: string };
        return value.theme === 'light';
      }, '浅色主题没有写入');
      await setTheme('system');
      await page.evaluate(async () => {
        await window.workStudio.command('settings', 'appearance', 'set', {
          zoom: 125,
        });
      });
      await ctx.expect.poll(async () => {
        const value = (await page.evaluate(() =>
          window.workStudio.subscribe('settings', 'appearance'),
        )) as { zoom?: number };
        return value.zoom === 125;
      }, '缩放百分比没有写入');
    } finally {
      await page.evaluate(async () => {
        await window.workStudio.command('settings', 'appearance', 'set', {
          theme: 'system',
          zoom: 100,
        });
      });
    }
  },
});
