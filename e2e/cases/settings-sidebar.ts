import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.sidebar',
  title: '侧栏打开设置后通过内部导航切换分类',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('sidebar-nav-settings');
    const page = await ctx.waitForPage(/settings\/appearance\/index\.html/);
    await page.evaluate(() => {
      document.querySelectorAll('nav button').forEach((button) => {
        if (button.textContent === '偏好设置')
          (button as HTMLButtonElement).click();
      });
    });
    await ctx.waitForPage(/settings\/preferences\/index\.html/);
    await ctx.expect.poll(
      async () =>
        (await ctx.appBridge.peek<Array<{ title: string }>>('/views'))?.some(
          (view) => view.title === '偏好设置',
        ) ?? false,
      '内部导航没有打开偏好设置',
    );
    await ctx.expect.text('sidebar', '工作区资料');
  },
});
