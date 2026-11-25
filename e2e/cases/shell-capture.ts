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
    const windowId = await ctx.evaluate(() => window.workStudio.workspaceId);
    if (!windowId) throw new Error('窗口未绑定工作区');
    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'begin', {
        input: {
          type: 'pane-resize',
          side: 'left',
          pointerX: 0,
          pointerY: 0,
        },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'move', {
        input: { pointerX: 40, pointerY: 0 },
      });
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
          return Boolean(record?.preview);
        }),
      '拖拽预览未生成',
    );

    const capture = await ctx.waitForPage(/^work:\/\/studio\/capture$/);
    await capture.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async () => {
          const id = window.workStudio.workspaceId;
          if (!id) return false;
          const record = (await window.workStudio.subscribe(
            'shell',
            `${id}/layout`,
          )) as LayoutRecord | null;
          return record?.preview === null;
        }),
      '捕获层 pointerup 没有结束交互',
    );
  },
});
