import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
  active: boolean;
  pinned: boolean;
}

export default defineCase({
  id: 'tabs.actions',
  title: '标签固定、移动、左右关闭与全部关闭',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const workspace = await ctx.legacyBridge.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) throw new Error('workspace not ready');
    await ctx.legacyBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
      url: 'data:text/html,<h1>ACTIONS</h1>',
      title: 'ACTIONS',
    });
    await ctx.expect.poll(
      async () =>
        ((await ctx.legacyBridge.peek<ViewInfo[]>('/views'))?.length ?? 0) >= 2,
      '标签不足',
    );

    const views = (await ctx.legacyBridge.peek<ViewInfo[]>('/views')) ?? [];
    const web = views.find((view) => view.title === 'ACTIONS');
    if (!web) throw new Error('网页标签不存在');
    await ctx.evaluate(async (id) => {
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
        'pin',
        { id },
      );
    }, web.id);
    await ctx.expect.poll(async () => {
      const next = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
        ),
      )) as ViewInfo[];
      return next.find((view) => view.id === web.id)?.pinned === true;
    }, '标签未固定');

    await ctx.evaluate(async (id) => {
      const list = (await window.workStudio.subscribe(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
      )) as ViewInfo[];
      const other = list.find((view) => view.id !== id);
      if (other) {
        await window.workStudio.command(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
          'move',
          {
            fromId: id,
            toId: other.id,
          },
        );
      }
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
        'closeLeft',
        { id },
      );
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
        'closeRight',
        { id },
      );
    }, web.id);
    await ctx.expect.poll(async () => {
      const next = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
        ),
      )) as ViewInfo[];
      return next.length === 1 && next[0]?.id === web.id;
    }, '左右关闭未保留锚点');

    await ctx.evaluate(async () => {
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/views`,
        'closeAll',
      );
    });
    await ctx.expect.poll(
      async () => (await ctx.text('doc-tabs')).includes('欢迎'),
      '全部关闭后欢迎页没有恢复',
    );
  },
});
