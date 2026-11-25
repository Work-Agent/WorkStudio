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
    await ctx.evaluate(() => {
      const button = document.querySelector(
        '[title="切换为亮色"], [title="切换为暗色"]',
      ) as HTMLButtonElement | null;
      if (!button) throw new Error('主题按钮不存在');
      button.click();
    });
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
    await ctx.evaluate(async () => {
      await window.workStudio.command('shell', 'appearance', 'set', {
        source: 'system',
      });
    });
  },
});
