import { defineCase } from '../runner/contract.ts';

interface Appearance {
  source?: 'light' | 'dark' | 'system';
}

interface ViewRecord {
  id: string;
}

export default defineCase({
  id: 'shell.new-page-theme',
  title: '深色模式打开新页面时首帧不出现白底',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const before = (await ctx.evaluate(() =>
      window.workStudio.subscribe('shell', 'appearance'),
    )) as Appearance;
    await ctx.evaluate(async () => {
      await window.workStudio.command('shell', 'appearance', 'set', {
        source: 'dark',
      });
    });

    let viewId: string | null = null;
    try {
      const result = await ctx.evaluate(async () => {
        const command = await window.workStudio.command<ViewRecord>(
          'settings',
          'pages',
          'open',
          { pageId: 'appearance' },
        );
        return command.ok ? command.data : null;
      });
      viewId = result?.id ?? null;
      const page = await ctx.waitForPage(
        /work:\/\/studio\/settings\/appearance/,
      );
      await ctx.expect.poll(async () => {
        const state = await page.evaluate(() => ({
          background: getComputedStyle(document.documentElement)
            .backgroundColor,
          gate: [...document.querySelectorAll('head style')].some((style) =>
            style.textContent?.includes('prefers-color-scheme:dark'),
          ),
        }));
        return state.background === 'rgb(26, 28, 29)' && state.gate;
      }, '新页面没有使用深色首帧底色');
    } finally {
      if (viewId) {
        await ctx.evaluate(async (id) => {
          await window.workStudio.command('shell', 'views', 'close', { id });
        }, viewId);
      }
      await ctx.evaluate(async (source) => {
        await window.workStudio.command('shell', 'appearance', 'set', {
          source,
        });
      }, before.source ?? 'system');
    }
  },
});
