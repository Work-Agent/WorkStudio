import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  windowId: string;
  preview: unknown;
}

export default defineCase({
  id: 'shell.capture',
  title: '拖拽捕获层收到 pointerup 后结束预览',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const record = (await ctx.evaluate(() =>
      window.workStudio.subscribe('shell', 'layout'),
    )) as LayoutRecord[];
    const windowId = record[0]?.windowId;
    if (!windowId) throw new Error('布局未就绪');
    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', 'layout', 'begin', {
        windowId: id,
        input: {
          type: 'pane-resize',
          side: 'left',
          pointerX: 0,
          pointerY: 0,
        },
      });
      await window.workStudio.command('shell', 'layout', 'move', {
        windowId: id,
        input: { pointerX: 40, pointerY: 0 },
      });
    }, windowId);
    await ctx.expect.poll(async () => {
      const next = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return Boolean(next[0]?.preview);
    }, '拖拽预览未生成');

    const capture = await ctx.waitForPage(/^work:\/\/studio\/capture$/);
    await capture.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await ctx.expect.poll(async () => {
      const next = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return next[0]?.preview === null;
    }, '捕获层 pointerup 没有结束交互');
  },
});
