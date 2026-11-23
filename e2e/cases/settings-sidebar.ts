import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.sidebar',
  title: '标题栏打开设置后可展开卡片',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('titlebar-settings');
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await page.evaluate(() => {
      const card = document.querySelector('[data-page="preferences"]');
      (card?.querySelector('button') as HTMLButtonElement | undefined)?.click();
    });
    await page.expect.text('[data-page="preferences"]', '偏好设置');
    await page.expect.text('[data-page="preferences"]', 'App 默认');
  },
});
