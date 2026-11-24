import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'resources.diagnostics',
  title: '资源诊断卡片订阅资源状态',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'resources' });
    const page = await ctx.waitForPage(/pages\/settings\/index\.html/);
    await ctx.expect.poll(async () => {
      const state = (await page.evaluate(async () => {
        const workspace = (await window.workStudio.subscribe(
          'workspaces',
          'current',
        )) as { id?: string } | null;
        return window.workStudio.subscribe(
          'resources',
          workspace?.id ? `ws:${workspace.id}` : 'current',
        );
      })) as { workspaceId?: string | null; ready?: boolean };
      return Boolean(state.workspaceId) && state.ready === true;
    }, '资源状态未就绪');
  },
});
