import { defineCase, type PageHandle } from '../runner/contract.ts';

interface Appearance {
  source?: 'light' | 'dark' | 'system';
  theme?: 'light' | 'dark';
}

export default defineCase({
  id: 'shell.theme-toggle',
  title: 'TitleBar 主题按钮切换 source 并生效',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const before = (await ctx.evaluate(() =>
      window.workStudio.subscribe('shell', 'appearance'),
    )) as Appearance;
    await ctx.clickTestId('theme-toggle');
    await ctx.expect.poll(async () => {
      const next = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'appearance'),
      )) as Appearance;
      return next.source !== before.source;
    }, '主题 source 没有切换');
    const next = (await ctx.evaluate(() =>
      window.workStudio.subscribe('shell', 'appearance'),
    )) as Appearance;
    const expectedDark = next.theme === 'dark';
    const welcome = await ctx.waitForPage(/^work:\/\/studio\/welcome$/);
    const assistant = await ctx.waitForPage(/^work:\/\/studio\/assistant$/);
    await ctx.expect.poll(async () => {
      const matches = (page: PageHandle) =>
        page.evaluate((dark) => {
          const root = getComputedStyle(document.documentElement);
          return (
            matchMedia('(prefers-color-scheme: dark)').matches === dark &&
            root.colorScheme === (dark ? 'dark' : 'light')
          );
        }, expectedDark);
      return (await matches(welcome)) && (await matches(assistant));
    }, '系统视图主题没有同步');
    // 回到跟随系统：theme 必须按系统重新解析，而不是停在显式值上。
    await ctx.evaluate(async () => {
      await window.workStudio.command('shell', 'appearance', 'set', {
        source: 'light',
      });
      await window.workStudio.command('shell', 'appearance', 'set', {
        source: 'system',
      });
    });
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'appearance'),
      )) as Appearance;
      const systemDark = await ctx.evaluate(
        () => matchMedia('(prefers-color-scheme: dark)').matches,
      );
      return state.theme === (systemDark ? 'dark' : 'light');
    }, '跟随系统时 theme 没有按系统解析');
    // 图标与 title 都描述当前生效主题，不能只跟 source 走。
    await ctx.expect.poll(
      () =>
        ctx.evaluate(() => {
          const button = document.querySelector('[data-testid="theme-toggle"]');
          if (!button) return false;
          const title = button.getAttribute('title') ?? '';
          const dark = title.startsWith('当前深色');
          const icon = button.querySelector('svg')?.getAttribute('class') ?? '';
          return (
            matchMedia('(prefers-color-scheme: dark)').matches === dark &&
            icon.includes(dark ? 'lucide-moon' : 'lucide-sun')
          );
        }),
      '主题图标与当前主题不一致',
    );
  },
});
