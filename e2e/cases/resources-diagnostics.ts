import { defineCase } from '../runner/contract.ts';

/** 结构里的噪声：隐藏项与构建 / 运行时目录不进任何一层列举。 */
const NOISE = new Set([
  'node_modules',
  'sites',
  'dist',
  'out',
  'coverage',
  'test-results',
]);

export default defineCase({
  id: 'workspace.search',
  title: '工作区搜索资源就绪并可读取目录',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'workspace',
          `${String(window.workStudio.workspaceId)}/search`,
        ),
      )) as { workspaceId?: string; ready?: boolean };
      return Boolean(state?.workspaceId) && state.ready === true;
    }, '工作区搜索资源未就绪');

    // 页面资源树与助手 ls 共用同一套列举：噪声在命令出口就已经滤掉。
    const names = (await ctx.evaluate(async () => {
      const result = await window.workStudio.command<unknown[]>(
        'workspace',
        `${String(window.workStudio.workspaceId)}/search`,
        'ls',
        {},
      );
      return result.ok && Array.isArray(result.data)
        ? result.data.map((entry) =>
            String((entry as { name?: unknown }).name ?? ''),
          )
        : null;
    })) as string[] | null;
    if (!names) throw new Error('目录读取失败');

    const noise = names.filter(
      (name) => name.startsWith('.') || NOISE.has(name),
    );
    if (noise.length > 0) {
      throw new Error(`结构里露出噪声条目：${noise.join(', ')}`);
    }
  },
});
