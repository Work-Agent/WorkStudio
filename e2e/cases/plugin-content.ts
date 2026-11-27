import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface AccessProbe {
  own: boolean;
  scoped: boolean;
  other: unknown;
}

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
    // 文件名带中文：ref 必然是百分号编码形式，和传输层产出的 ref 一致。
    const file = join(root, '前赤壁赋-e2e.html');
    try {
      writeFileSync(file, '<html><body><h1>PLUGIN CONTENT</h1></body></html>');
      const ref = pathToFileURL(file).toString();
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
          `${workspaceId}/resources`,
          'action',
          {
            action: 'open',
            node: {
              key: target,
              type: 'file',
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

      // 内容页能读自己这个 ref（新旧两种地址名都认），读不到别的 ref。
      const access = (await page.evaluate(async (raw) => {
        const target = String(raw);
        const own = await window.workStudio.subscribe('workspace', target);
        const scoped = await window.workStudio.subscribe(
          'workspace',
          `${String(window.workStudio.workspaceId)}/${target}`,
        );
        const other = await window.workStudio.subscribe(
          'workspace',
          'file:///etc/hosts',
        );
        return {
          own: Array.isArray(own),
          scoped: Array.isArray(scoped),
          other,
        };
      }, ref)) as AccessProbe;
      if (!access.own) throw new Error('内容页读不到自己打开的 ref');
      if (!access.scoped) throw new Error('内容页读不到带 wsId 的资源地址');
      if (access.other !== null) throw new Error('内容页读到了无关资源');
    } finally {
      rmSync(file, { force: true });
    }
  },
});
