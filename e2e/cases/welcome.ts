import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
}

export default defineCase({
  id: 'welcome.page',
  title: '欢迎页作为唯一内置页保留，空标签时自动恢复',
  tags: ['dev', 'ci'],
  async run(ctx) {
    // 启动 / 上一个用例清理后，空标签会恢复欢迎页。
    await ctx.expect.poll(
      async () => (await ctx.text('doc-tabs')).includes('欢迎'),
      '空标签时没有欢迎页',
    );
    const welcomePage = await ctx.waitForPage(
      /^(work:\/\/studio\/welcome|.*pages\/welcome\/index\.html)/,
    );
    await ctx.expect.poll(
      async () => welcomePage.evaluate(() => innerWidth > 0 && innerHeight > 0),
      '欢迎页没有有效视口',
    );
    const before = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
    const welcome = before?.find((view) => view.title === '欢迎');
    if (!welcome) throw new Error('欢迎视图不存在');

    // 再次打开欢迎页必须复用同一个 tab。
    await ctx.legacyBridge.call('/settings/open', { pageId: 'welcome' });
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return views?.filter((view) => view.title === '欢迎').length === 1;
    }, '欢迎页被重复打开');

    // 有别的 tab 时欢迎页可以被关闭；关闭全部后应自动回来。
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    await ctx.legacyBridge.call(`/views/${welcome.id}/close`);
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return !(views ?? []).some((view) => view.id === welcome.id);
    }, '欢迎页没有关闭');
    const all = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
    for (const view of all ?? []) {
      await ctx.legacyBridge.call(`/views/${view.id}/close`);
    }
    await ctx.expect.poll(
      async () => (await ctx.text('doc-tabs')).includes('欢迎'),
      '关闭全部标签后欢迎页没有恢复',
    );
  },
});
