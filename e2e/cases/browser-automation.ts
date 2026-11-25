import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
}

export default defineCase({
  id: 'browser.automation',
  title: '浏览器自动化与网页快照保存',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>AUTOMATION</h1></body></html>');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('no address');
    }
    const url = `http://127.0.0.1:${address.port}/`;
    try {
      const workspace = await ctx.legacyBridge.peek<{ id: string }>(
        '/workspaces/current',
      );
      if (!workspace) throw new Error('workspace not ready');
      await ctx.legacyBridge.call(
        `/workspaces/${workspace.id}/sites/web/open`,
        {
          url,
          title: 'AUTOMATION',
        },
      );
      await ctx.waitForPage(new RegExp(String(address.port)));
      const views = await ctx.legacyBridge.peek<ViewInfo[]>('/views');
      const view = views?.find((item) => item.title === 'AUTOMATION');
      if (!view) throw new Error('浏览器视图不存在');
      const attached = await ctx.evaluate(async (id) => {
        const result = await window.workStudio.command(
          'browser',
          `${String(window.workStudio.workspaceId)}/automation`,
          'attach',
          { id },
        );
        return result.ok;
      }, view.id);
      if (!attached) throw new Error('自动化附加失败');
      const title = await ctx.evaluate(async (id) => {
        const result = await window.workStudio.command(
          'browser',
          `${String(window.workStudio.workspaceId)}/automation`,
          'execute',
          { id, script: 'document.title || document.body.innerText' },
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.data;
      }, view.id);
      if (title !== 'AUTOMATION' && title !== 'AUTOMATION\n')
        throw new Error(`脚本结果异常：${title}`);

      const saved = await ctx.evaluate(async (target) => {
        const captured = await window.workStudio.command(
          'web',
          'web',
          'capture',
          { url: target },
        );
        if (!captured.ok) throw new Error(captured.error.message);
        const result = await window.workStudio.command('web', 'web', 'save', {
          url: target,
        });
        if (!result.ok) throw new Error(result.error.message);
        return result.data as { ref: string };
      }, url);
      const file = fileURLToPath(saved.ref);
      if (!readFileSync(file, 'utf-8').includes('AUTOMATION')) {
        throw new Error('网页快照未写入工作区');
      }
    } finally {
      server.close();
    }
  },
});
