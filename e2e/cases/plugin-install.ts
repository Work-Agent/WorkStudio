import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineCase } from '../runner/contract.ts';

interface Installed {
  id: string;
  stage: string;
}

export default defineCase({
  id: 'plugin.install',
  title: '本地目录插件可安装、激活并卸载',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const root = mkdtempSync(join(tmpdir(), 'work-studio-plugin-'));
    const id = 'e2e-local-plugin';
    try {
      mkdirSync(join(root, 'pages'), { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: `@workstudio/${id}`,
          version: '1.0.0',
          type: 'module',
          workstudio: {
            id,
            label: 'E2E 本地插件',
            pages: {
              content: 'pages/index.html',
              settings: 'pages/settings.html',
            },
          },
          exports: { './workstudio': './engine.js' },
        }),
      );
      writeFileSync(join(root, 'commands.json'), '{}');
      writeFileSync(
        join(root, 'engine.js'),
        'export const workstudio = { resources: {}, commands: {} };\n',
      );
      writeFileSync(
        join(root, 'pages/index.html'),
        '<html><body><h1>E2E LOCAL PLUGIN</h1></body></html>',
      );
      writeFileSync(
        join(root, 'pages/settings.html'),
        '<html><body><h1>E2E LOCAL SETTINGS</h1></body></html>',
      );

      const installed = await ctx.evaluate(async (source) => {
        const result = await window.workStudio.command(
          'plugin',
          'installed',
          'install',
          { source },
        );
        if (!result.ok) throw new Error(result.error.message);
        return result.data as string;
      }, root);
      if (installed !== id) throw new Error(`插件 id 不符：${installed}`);

      await ctx.expect.poll(async () => {
        const list = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'installed'),
        )) as Installed[];
        return list.some((item) => item.id === id && item.stage === 'ready');
      }, '本地插件未激活');

      await ctx.evaluate(async (pluginId) => {
        await window.workStudio.command('plugin', 'installed', 'open', {
          id: pluginId,
        });
      }, id);
      const page = await ctx.waitForPage(new RegExp(`${id}/settings`));
      await page.expect.text('body', 'E2E LOCAL SETTINGS');

      await ctx.evaluate(async (pluginId) => {
        await window.workStudio.command('plugin', 'installed', 'remove', {
          id: pluginId,
        });
      }, id);
      await ctx.expect.poll(async () => {
        const list = (await ctx.evaluate(() =>
          window.workStudio.subscribe('plugin', 'installed'),
        )) as Installed[];
        return !list.some((item) => item.id === id);
      }, '本地插件未卸载');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
});
