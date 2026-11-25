import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  windowId: string;
  scene?: {
    sidebarCollapsed?: boolean;
    aiOpen?: boolean;
    paneWidths?: { left: number; right: number };
  };
  snapshot?: { sidebar?: { width: number }; assistantVisible?: boolean };
}

export default defineCase({
  id: 'shell.layout',
  title: '壳层布局可折叠、拖拽并提交场景',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const workspace = await ctx.legacyBridge.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) throw new Error('workspace not ready');

    const windowId = await ctx.evaluate(() => window.workStudio.workspaceId);
    if (!windowId) throw new Error('窗口未绑定工作区');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async (id) => {
          const record = (await window.workStudio.subscribe(
            'shell',
            `${id}/layout`,
          )) as LayoutRecord | null;
          return record !== null;
        }, windowId),
      '窗口布局未发布',
    );

    await ctx.evaluate(async (id) => {
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { sidebarCollapsed: true, aiOpen: false },
      });
    }, windowId);

    await ctx.expect.poll(
      async () =>
        ctx.evaluate(async (id) => {
          const record = (await window.workStudio.subscribe(
            'shell',
            `${id}/layout`,
          )) as LayoutRecord | null;
          return (
            record?.scene?.sidebarCollapsed === true &&
            record.scene.aiOpen === false &&
            record.snapshot?.sidebar?.width === 56 &&
            record.snapshot.assistantVisible === false
          );
        }, windowId),
      '布局场景未收敛到快照',
    );

    await ctx.evaluate(async (id) => {
      const before = (await window.workStudio.subscribe(
        'shell',
        `${id}/layout`,
      )) as LayoutRecord | null;
      const width = before?.scene?.paneWidths?.left ?? 240;
      await window.workStudio.command('shell', `${id}/layout`, 'begin', {
        input: {
          type: 'pane-resize',
          side: 'left',
          pointerX: 0,
          pointerY: 0,
        },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'move', {
        input: { pointerX: 80, pointerY: 0 },
      });
      await window.workStudio.command('shell', `${id}/layout`, 'end', {});
      const after = (await window.workStudio.subscribe(
        'shell',
        `${id}/layout`,
      )) as LayoutRecord | null;
      const next = after?.scene?.paneWidths?.left ?? width;
      if (next === width) throw new Error('拖拽未提交左栏宽度');
    }, windowId);
  },
});
