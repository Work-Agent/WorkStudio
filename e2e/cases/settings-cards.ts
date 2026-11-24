import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.cards',
  title: '设置卡片逐一展开并渲染内容',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await ctx.expect.poll(async () => {
      const count = await page.evaluate(
        () => document.querySelectorAll('[data-page]').length,
      );
      return count >= 8;
    }, '设置卡片未渲染');
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-page]')].map(
        (node) => node.getAttribute('data-page') ?? '',
      ),
    );
    for (const card of cards) {
      await page.evaluate((id) => {
        const header = document.querySelector(`[data-page="${id}"] button`);
        (header as HTMLButtonElement | null)?.click();
      }, card);
      await ctx.expect.poll(async () => {
        const text = await page.evaluate((id) => {
          const node = document.querySelector(`[data-page="${id}"]`);
          return node?.textContent ?? '';
        }, card);
        return text.length > (card.length ?? 0);
      }, `设置卡片未展开：${card}`);
    }
  },
});
