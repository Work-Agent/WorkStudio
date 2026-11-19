import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
}

export default defineCase({
  id: 'tabs.bulk',
  title: '标签批量关闭保留欢迎页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const workspace = await ctx.legacyBridge.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) throw new Error('workspace not ready');
    await ctx.legacyBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
      url: 'data:text/html,<h1>BULK</h1>',
      title: 'BULK',
    });
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return (views?.length ?? 0) >= 3;
    }, '批量关闭前标签不足');
    const settings = (await ctx.legacyBridge.peek<ViewInfo[]>('/views'))?.find(
      (view) => view.title === '设置',
    );
    if (!settings) throw new Error('设置标签不存在');
    await ctx.legacyBridge.call(`/views/${settings.id}/close`);
    await ctx.expect.poll(async () => {
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      return (views?.length ?? 0) >= 2;
    }, '关闭设置后标签集合异常');
  },
});
