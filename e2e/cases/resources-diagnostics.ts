import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'workspace.search',
  title: '工作区搜索资源就绪并可读取目录',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe('workspace', 'search'),
      )) as { workspaceId?: string; ready?: boolean };
      return Boolean(state?.workspaceId) && state.ready === true;
    }, '工作区搜索资源未就绪');

    const entries = await ctx.evaluate(async () => {
      const result = await window.workStudio.command<unknown[]>(
        'workspace',
        'search',
        'ls',
        {},
      );
      return result.ok && Array.isArray(result.data) ? result.data.length : -1;
    });
    if (entries < 0) throw new Error('目录读取失败');
  },
});
