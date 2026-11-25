import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';

interface SessionsSnapshot {
  workspaceId?: string;
  current?: unknown;
}

export default defineCase({
  id: 'agent.workspace-scope',
  title: '每个工作区一份 agent 会话投影',
  tags: ['ci', 'mutating'],
  async run(ctx) {
    const original = (await ctx
      .evaluate(async () => {
        const registry = (await window.workStudio.subscribe(
          'workspace',
          'registry',
        )) as { current?: { id?: string; path?: string } | null };
        return JSON.stringify(registry?.current ?? null);
      })
      .then((value) => value as string)) as string;
    const current = JSON.parse(original) as { id: string; path: string };
    if (!current?.id) throw new Error('没有当前工作区');

    const directory = mkdtempSync(join(tmpdir(), 'work-studio-agent-'));
    try {
      const second = await ctx.evaluate(async (path) => {
        const result = await window.workStudio.command(
          'workspace',
          'registry',
          'open',
          { path },
        );
        if (!result.ok) throw new Error(result.error.message);
        return (result.data as { id: string }).id;
      }, directory);

      // 新工作区的会话投影独立存在，且带上自己的 wsId。
      await ctx.expect.poll(async () => {
        const snapshot = (await ctx.evaluate(async (id) => {
          return (await window.workStudio.subscribe(
            'agent',
            `${id}/sessions`,
          )) as SessionsSnapshot | null;
        }, second)) as SessionsSnapshot | null;
        return snapshot?.workspaceId === second;
      }, '第二个工作区没有独立的 agent 会话投影');

      // 原窗口的投影仍属于原工作区。
      const first = (await ctx.evaluate(async (id) => {
        return (await window.workStudio.subscribe(
          'agent',
          `${id}/sessions`,
        )) as SessionsSnapshot | null;
      }, current.id)) as SessionsSnapshot | null;
      if (first?.workspaceId !== current.id) {
        throw new Error('原工作区会话投影被串改');
      }

      await ctx.evaluate(async (id) => {
        await window.workStudio.command('shell', 'windows', 'close', { id });
        await window.workStudio.command('workspace', 'registry', 'remove', {
          id,
        });
      }, second);
    } finally {
      await ctx
        .evaluate(async (path) => {
          await window.workStudio.command('workspace', 'registry', 'open', {
            path,
          });
        }, current.path)
        .catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
    }
  },
});
