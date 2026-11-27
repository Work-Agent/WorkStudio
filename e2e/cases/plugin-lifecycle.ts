import { defineCase } from '../runner/contract.ts';
import { ensureBuiltinPlugin } from '../support/plugin-fixture.ts';

interface Installed {
  id: string;
  label: string;
  stage: string;
}

export default defineCase({
  id: 'plugin.lifecycle',
  title: '插件已安装、可打开设置并重载',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureBuiltinPlugin(ctx, 'text-editor');
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe('plugin', 'installed'),
      )) as Installed[];
      return list.some((item) => item.id === 'text-editor');
    }, '内置插件未安装');

    await ctx.evaluate(async () => {
      await window.workStudio.command('plugin', 'installed', 'open', {
        id: 'text-editor',
      });
    });
    const page = await ctx.waitForPage(/text-editor\/settings/);
    await page.expect.text('body', '自动换行');

    await ctx.evaluate(async () => {
      await window.workStudio.command('plugin', 'installed', 'reload', {
        id: 'text-editor',
      });
    });
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe('plugin', 'installed'),
      )) as Installed[];
      return list.some(
        (item) => item.id === 'text-editor' && item.stage === 'ready',
      );
    }, '插件重载后未回到 ready');
  },
});
