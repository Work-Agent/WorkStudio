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
    // 常驻窗口会沿用持久化布局，先归一化再断言折叠 / 展开。
    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: {
          sidebarCollapsed: false,
          aiOpen: true,
          aiFloating: false,
          paneWidths: { left: 240, right: 420 },
        },
      });
    });
    const sidebarWidth = async (): Promise<number | undefined> =>
      ctx.evaluate(async () => {
        const id = window.workStudio.workspaceId;
        if (!id) return undefined;
        const record = (await window.workStudio.subscribe(
          'shell',
          `${id}/layout`,
        )) as LayoutRecord | null;
        return record?.snapshot?.sidebar?.width;
      });
    await ctx.clickTestId('sidebar-toggle');
    await ctx.expect.poll(
      async () => (await sidebarWidth()) === 56,
      '侧栏没有收起为 56px',
    );
    await ctx.clickTestId('sidebar-toggle');
    await ctx.expect.poll(
      async () => (await sidebarWidth()) === 240,
      '侧栏没有恢复为 240px',
    );

    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      const record = (await window.workStudio.subscribe(
        'shell',
        `${id}/layout`,
      )) as LayoutRecord | null;
      const scene = record?.scene ?? {};
      const button = document.querySelector(
        '[title="收起 AI 对话"], [title="展开 AI 对话"]',
      ) as HTMLButtonElement | null;
      button?.click();
      if (button) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { aiOpen: scene.aiOpen === false },
      });
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
          return record?.snapshot?.assistantVisible === false;
        }),
      '助手没有收起',
    );
    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/layout`, 'scene', {
        patch: { aiOpen: true, sidebarCollapsed: false },
      });
    });
  },
});
