import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';

interface Storage {
  dataRoot: string;
  workspaceId: string;
}

export default defineCase({
  id: 'shell.layout-persist',
  title: '布局场景写入 ui-state.json 并可恢复',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const storage = (await ctx.evaluate(() =>
      window.workStudio.subscribe('settings', 'storage'),
    )) as Storage;
    if (!storage.dataRoot) throw new Error('数据根不可用');
    await ctx.evaluate(async (windowId) => {
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId,
        patch: {
          sidebarCollapsed: true,
          paneWidths: { left: 300, right: 360 },
        },
      });
    }, storage.workspaceId);
    const file = join(storage.dataRoot, 'ui-state.json');
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<
      string,
      { sidebarCollapsed?: boolean; paneWidths?: { left: number } }
    >;
    const scene = raw[storage.workspaceId];
    if (scene?.sidebarCollapsed !== true || scene.paneWidths?.left !== 300) {
      throw new Error(`布局未持久化：${JSON.stringify(scene)}`);
    }
    await ctx.evaluate(async (windowId) => {
      await window.workStudio.command('shell', 'layout', 'scene', {
        windowId,
        patch: {
          sidebarCollapsed: false,
          aiOpen: true,
          aiFloating: false,
          paneWidths: { left: 240, right: 420 },
          floating: null,
        },
      });
    }, storage.workspaceId);
  },
});
