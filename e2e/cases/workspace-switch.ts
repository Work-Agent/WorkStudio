import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';

interface Registry {
  current?: { id: string; path: string } | null;
}

export default defineCase({
  id: 'workspace.switch',
  title: '工作区可切换并恢复原工作区',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const registry = (await ctx.evaluate(() =>
      window.workStudio.subscribe('workspace', 'registry'),
    )) as Registry;
    const initial = registry.current;
    if (!initial) throw new Error('没有当前工作区');
    const directory = mkdtempSync(join(tmpdir(), 'work-studio-switch-'));
    try {
      await ctx.evaluate(async (path) => {
        const result = await window.workStudio.command(
          'workspace',
          'registry',
          'open',
          { path },
        );
        if (!result.ok) throw new Error(result.error.message);
      }, directory);
      await ctx.expect.poll(async () => {
        const value = (await ctx.evaluate(() =>
          window.workStudio.subscribe('workspace', 'registry'),
        )) as Registry;
        return value.current?.path === directory;
      }, '工作区没有切换');
    } finally {
      await ctx.evaluate(async (path) => {
        await window.workStudio.command('workspace', 'registry', 'open', {
          path,
        });
      }, initial.path);
      rmSync(directory, { recursive: true, force: true });
    }
    await ctx.expect.poll(async () => {
      const value = (await ctx.evaluate(() =>
        window.workStudio.subscribe('workspace', 'registry'),
      )) as Registry;
      return value.current?.path === initial.path;
    }, '工作区没有恢复');
  },
});
