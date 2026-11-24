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

    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return records.some((record) => record.windowId === workspace.id);
    }, '窗口布局未发布');

    await ctx.evaluate(async (windowId) => {
      const id = String(windowId);
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId: id,
        patch: { sidebarCollapsed: true, aiOpen: false },
      });
    }, workspace.id);

    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      const record = records.find((item) => item.windowId === workspace.id);
      return (
        record?.scene?.sidebarCollapsed === true &&
        record.scene.aiOpen === false &&
        record.snapshot?.sidebar?.width === 56 &&
        record.snapshot.assistantVisible === false
      );
    }, '布局场景未收敛到快照');

    await ctx.evaluate(async (windowId) => {
      const id = String(windowId);
      const before = (await window.workStudio.subscribe(
        'shell',
        'layout',
      )) as LayoutRecord[];
      const width =
        before.find((item) => item.windowId === windowId)?.scene?.paneWidths
          ?.left ?? 240;
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
        input: { pointerX: 80, pointerY: 0 },
      });
      await window.workStudio.command('shell', 'layout', 'end', {
        windowId: id,
      });
      const after = (await window.workStudio.subscribe(
        'shell',
        'layout',
      )) as LayoutRecord[];
      const next =
        after.find((item) => item.windowId === windowId)?.scene?.paneWidths
          ?.left ?? width;
      if (next === width) throw new Error('拖拽未提交左栏宽度');
    }, workspace.id);
  },
});
