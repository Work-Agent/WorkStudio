import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  title: string;
  active: boolean;
}

export default defineCase({
  id: 'view.tabs',
  title: '标签栏显示多个视图并可激活标签',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const workspace = await ctx.legacyBridge.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) throw new Error('workspace not ready');
    await ctx.legacyBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
      url: 'data:text/html,<h1>TAB</h1>',
      title: 'TAB',
    });

    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return (views?.length ?? 0) >= 2;
    }, '打开设置和网页后标签数不足');
    await ctx.expect.text('doc-tabs', '设置');
    await ctx.expect.text('doc-tabs', 'TAB');
    await ctx.clickTitle('TAB');
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return views?.find((view) => view.active)?.title === 'TAB';
    }, '点击标签后网页未激活');
  },
});
