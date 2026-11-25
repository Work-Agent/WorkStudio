import { defineCase } from '../runner/contract.ts';

interface Notice {
  id: string;
  level: string;
  message: string;
}

export default defineCase({
  id: 'shell.notices',
  title: '通知资源可新增并关闭',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const notice = (await ctx.evaluate(async () => {
      const result = await window.workStudio.command<Notice>(
        'shell',
        `${String(window.workStudio.workspaceId)}/notices`,
        'notify',
        { level: 'warn', message: '回归通知' },
      );
      return result.ok ? result.data : null;
    })) as Notice | null;
    if (!notice) throw new Error('通知创建失败');
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/notices`,
        ),
      )) as Notice[];
      return list.some((item) => item.id === notice.id);
    }, '通知未进入资源');
    await ctx.evaluate(async (id) => {
      await window.workStudio.command(
        'shell',
        `${String(window.workStudio.workspaceId)}/notices`,
        'dismiss',
        { id },
      );
    }, notice.id);
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/notices`,
        ),
      )) as Notice[];
      return !list.some((item) => item.id === notice.id);
    }, '通知未关闭');
  },
});
