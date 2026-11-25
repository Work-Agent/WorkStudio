import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

export default defineCase({
  id: 'plugin.content',
  title: 'HTML 文件由插件认领并在插件页打开',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    const workspace = (await ctx.evaluate(() =>
      window.workStudio.subscribe('workspace', 'registry'),
    )) as { current?: { path: string } | null };
    const root = workspace.current?.path;
    if (!root) throw new Error('没有当前工作区');
    const file = join(root, '.e2e-plugin-content.html');
    try {
      writeFileSync(file, '<html><body><h1>PLUGIN CONTENT</h1></body></html>');
      const ref = `file://${file}`;
      const result = await ctx.evaluate(async (target) => {
        const registry = (await window.workStudio.subscribe(
          'workspace',
          'registry',
        )) as { current?: { id?: string } | null };
        const workspaceId =
          window.workStudio.workspaceId ?? registry.current?.id;
        if (!workspaceId) return { ok: false, error: '没有当前工作区' };
        const response = await window.workStudio.command(
          'workspace',
          `${workspaceId}/list`,
          'action',
          {
            action: 'open',
            item: {
              key: target,
              title: 'E2E HTML',
              meta: { ref: target },
            },
          },
        );
        return response.ok
          ? { ok: true }
          : { ok: false, error: response.error.message };
      }, ref);
      if (!result.ok) throw new Error(result.error);
      const page = await ctx.waitForPage(/^plugin:\/\/html-viewer\//);
      await page.expect.text('h1', 'HTML 阅读器');
      await page.expect.text('body', 'PLUGIN CONTENT');
    } finally {
      rmSync(file, { force: true });
    }
  },
});
