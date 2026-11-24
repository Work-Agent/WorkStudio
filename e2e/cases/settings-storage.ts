import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'settings.storage',
  title: '会话目录可写入存储投影',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const dir = mkdtempSync(join(tmpdir(), 'work-studio-sessions-'));
    try {
      const result = await ctx.evaluate(async (path) => {
        const response = await window.workStudio.command(
          'settings',
          'storage',
          'changeSessionDir',
          { path },
        );
        return response.ok ? response.data : `ERR:${response.error.message}`;
      }, dir);
      if (result !== dir) throw new Error('会话目录未写入');
      await ctx.expect.poll(async () => {
        const state = (await ctx.evaluate(() =>
          window.workStudio.subscribe('settings', 'storage'),
        )) as { sessionsDir?: string };
        return state.sessionsDir === dir;
      }, '存储投影未更新');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
