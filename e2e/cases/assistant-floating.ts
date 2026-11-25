import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  windowId: string;
  scene?: { aiFloating?: boolean; floating?: { x: number; y: number } };
  snapshot?: { assistantFloating?: { x: number; y: number } };
}

export default defineCase({
  id: 'assistant.floating',
  title: '助手浮动模式可拖拽并提交几何',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const windowId = await ctx.evaluate(() => window.workStudio.workspaceId);
    if (!windowId) throw new Error('窗口未绑定工作区');
    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { aiFloating: true, aiOpen: true },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'begin', {
        input: { type: 'view-move', target: 'assistant' },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'move', {});
      await window.workStudio.command('shell', `${id}/layout`, 'end', {});
    }, windowId);
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async () => {
          const id = window.workStudio.workspaceId;
          if (!id) return false;
          const record = (await window.workStudio.subscribe(
            'shell',
            `${id}/layout`,
          )) as LayoutRecord | null;
          return (
            record?.scene?.aiFloating === true &&
            Boolean(record.snapshot?.assistantFloating)
          );
        }),
      '浮动助手未产生几何',
    );

    const order = (await ctx.evaluate(async (id) => {
      const result = await window.workStudio.command(
        'shell',
        'native',
        'viewOrder',
        { windowId: id },
      );
      return result.ok ? result.data : [];
    }, windowId)) as Array<{ id: string; type: string }>;
    const assistantIndex = order.findIndex((item) => item.type === 'assistant');
    let pageIndex = -1;
    order.forEach((item, index) => {
      if (item.type === 'page' || item.type === 'web') pageIndex = index;
    });
    if (assistantIndex < 0) throw new Error('浮动助手视图不存在');
    if (pageIndex >= 0 && assistantIndex < pageIndex) {
      throw new Error('浮动助手被页面视图覆盖');
    }
    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { aiFloating: false, floating: null },
      });
    });
  },
});
