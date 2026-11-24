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
    const record = (await ctx.evaluate(async () => {
      const layout = (await window.workStudio.subscribe(
        'shell',
        'layout',
      )) as LayoutRecord[];
      return layout[0] ?? null;
    })) as LayoutRecord | null;
    if (!record?.windowId) throw new Error('布局未就绪');
    await ctx.evaluate(async (windowId) => {
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId,
        patch: { aiFloating: true, aiOpen: true },
      });
      await window.workStudio.command('shell', 'layout', 'begin', {
        windowId,
        input: { type: 'view-move', target: 'assistant' },
      });
      await window.workStudio.command('shell', 'layout', 'move', {
        windowId,
      });
      await window.workStudio.command('shell', 'layout', 'end', { windowId });
    }, record.windowId);
    await ctx.expect.poll(async () => {
      const layout = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      const next = layout.find((item) => item.windowId === record.windowId);
      return (
        next?.scene?.aiFloating === true &&
        Boolean(next.snapshot?.assistantFloating)
      );
    }, '浮动助手未产生几何');
    await ctx.evaluate(async (windowId) => {
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId,
        patch: { aiFloating: false, floating: null },
      });
    }, record.windowId);
  },
});
