import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.address',
  title: '设置卡片切换时地址栏标题跟随，不跳回欢迎页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await ctx.expect.poll(
      async () =>
        page.evaluate(
          () => !!document.querySelector('[data-page="preferences"] > button'),
        ),
      '设置卡片尚未渲染',
    );

    const openCard = async (card: string): Promise<void> => {
      await page.evaluate((id) => {
        const header = document.querySelector(`[data-page="${id}"] > button`);
        header?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
      }, card);
    };

    await openCard('preferences');
    await ctx.expect.poll(async () => {
      const address = await ctx.text('resource-url-bar');
      return address === '设置 · 偏好设置';
    }, '偏好设置卡片没有更新地址栏标题');
    await ctx.expect.poll(async () => {
      const views = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
        ),
      )) as Array<{ active?: boolean; url?: string }>;
      return Boolean(
        views
          .find((view) => view.active)
          ?.url?.startsWith('work://studio/settings/'),
      );
    }, '切换设置卡片后跳回了欢迎页');

    await openCard('storage');
    await ctx.expect.poll(async () => {
      const address = await ctx.text('resource-url-bar');
      return address === '设置 · 存储与数据';
    }, '存储卡片没有更新地址栏标题');
  },
});
