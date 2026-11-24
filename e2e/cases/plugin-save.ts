import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

export default defineCase({
  id: 'plugin.save',
  title: '插件命令可写回认领资源',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    const workspace = (await ctx.evaluate(() =>
      window.workStudio.subscribe('workspace', 'registry'),
    )) as { current?: { path: string } | null };
    const root = workspace.current?.path;
    if (!root) throw new Error('没有当前工作区');
    const file = join(root, '.e2e-plugin-save.html');
    try {
      writeFileSync(file, '<h1>before</h1>');
      const ref = `file://${file}`;
      const result = await ctx.evaluate(async (target) => {
        const response = await window.workStudio.command(
          'html-viewer',
          'html-viewer',
          'save',
          { ref: target, content: '<h1>after</h1>' },
        );
        return response.ok ? null : response.error.message;
      }, ref);
      if (result) throw new Error(result);
      const content = readFileSync(file, 'utf-8');
      if (!content.includes('after')) {
        throw new Error(`插件未写回文件：${content}`);
      }
    } finally {
      rmSync(file, { force: true });
    }
  },
});
