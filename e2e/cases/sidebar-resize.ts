import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  scene?: {
    sidebarCollapsed?: boolean;
    paneWidths?: { left: number };
  };
  preview?: { paneWidths?: { left: number } } | null;
  snapshot?: { sidebar?: { width: number } };
}

export default defineCase({
  id: 'sidebar.resize',
  title: '收起侧栏向右拖拽时从收起宽度平滑展开',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const windowId = await ctx.evaluate(() => window.workStudio.workspaceId);
    if (!windowId) throw new Error('窗口未绑定工作区');
    const record = (): Promise<LayoutRecord | null> =>
      ctx.evaluate(async (id) => {
        return (await window.workStudio.subscribe(
          'shell',
          `${id}/layout`,
        )) as LayoutRecord | null;
      }, windowId);

    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { sidebarCollapsed: true },
      });
    }, windowId);
    await ctx.expect.poll(async () => {
      const state = await record();
      return state?.scene?.sidebarCollapsed === true;
    }, '侧栏未收起');

    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'begin', {
        input: {
          type: 'pane-resize',
          side: 'left',
          pointerX: 56,
          pointerY: 40,
        },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'move', {
        input: { pointerX: 100, pointerY: 40 },
      });
    }, windowId);
    await ctx.expect.poll(async () => {
      const state = await record();
      const width = state?.preview?.paneWidths?.left ?? 0;
      return width >= 90 && width <= 112;
    }, '收起态展开没有从 56px 跟手');

    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'move', {
        input: { pointerX: 220, pointerY: 40 },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'end', {});
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: {
          sidebarCollapsed: false,
          paneWidths: { left: 240, right: 420 },
        },
      });
    }, windowId);
  },
});
