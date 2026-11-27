import { defineCase } from '../runner/contract.ts';

/**
 * 会话标签只对真实文件开：点到一个已被删掉的会话时不能悄悄新建会话。
 * 回归的是「点标签没反应 / 反而多出一个新任务」这类低级问题。
 */
export default defineCase({
  id: 'assistant.tabs',
  title: '会话标签打开已删除的会话时不新建会话',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const before = await ctx.evaluate(async () => {
      const workspaceId = window.workStudio.workspaceId;
      const state = (await window.workStudio.subscribe(
        'agent',
        `${workspaceId}/sessions`,
      )) as { opened?: string[] } | null;
      return (state?.opened ?? []).length;
    });

    const result = await ctx.evaluate(async () => {
      const workspaceId = window.workStudio.workspaceId;
      return window.workStudio.command(
        'agent',
        `${workspaceId}/sessions`,
        'open',
        { id: '/tmp/work-studio-e2e-missing-session.jsonl' },
      );
    });
    if (result.ok) throw new Error('打开不存在的会话应当失败');
    if (result.error.code !== 'not_found') {
      throw new Error(`错误码不对：${result.error.code}`);
    }

    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async (count) => {
          const workspaceId = window.workStudio.workspaceId;
          const state = (await window.workStudio.subscribe(
            'agent',
            `${workspaceId}/sessions`,
          )) as { opened?: string[] } | null;
          return (state?.opened ?? []).length === count;
        }, before),
      '失败的打开不应改动标签集合',
    );
  },
});
