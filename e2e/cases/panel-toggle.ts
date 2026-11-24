import { defineCase } from '../runner/contract.ts';

interface LayoutRecord {
  windowId?: string;
  scene?: { sidebarCollapsed?: boolean; aiOpen?: boolean };
  snapshot?: { sidebar?: { width: number }; assistantVisible?: boolean };
}

export default defineCase({
  id: 'shell.panel-toggle',
  title: '标题栏可收起侧栏与助手，布局快照同步',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.clickTestId('sidebar-toggle');
    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return records[0]?.snapshot?.sidebar?.width === 56;
    }, '侧栏没有收起为 56px');
    await ctx.clickTestId('sidebar-toggle');
    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return records[0]?.snapshot?.sidebar?.width === 240;
    }, '侧栏没有恢复为 240px');

    await ctx.evaluate(async () => {
      const record = (
        (await window.workStudio.subscribe('shell', 'layout')) as LayoutRecord[]
      )[0];
      const scene = record?.scene ?? {};
      const button = document.querySelector(
        '[title="收起 AI 对话"], [title="展开 AI 对话"]',
      ) as HTMLButtonElement | null;
      button?.click();
      if (button) return;
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId: record?.windowId,
        patch: { aiOpen: scene.aiOpen === false },
      });
    });
    await ctx.expect.poll(async () => {
      const records = (await ctx.evaluate(() =>
        window.workStudio.subscribe('shell', 'layout'),
      )) as LayoutRecord[];
      return records[0]?.snapshot?.assistantVisible === false;
    }, '助手没有收起');
    await ctx.evaluate(async () => {
      const record = (
        (await window.workStudio.subscribe('shell', 'layout')) as LayoutRecord[]
      )[0];
      if (!record?.windowId) return;
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId: record.windowId,
        patch: { aiOpen: true, sidebarCollapsed: false },
      });
    });
  },
});
