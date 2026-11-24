import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface Installed {
  id: string;
  label: string;
  stage: string;
}

export default defineCase({
  id: 'plugin.lifecycle',
  title: '内置插件已安装、可打开设置并重载',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe('plugin', 'installed'),
      )) as Installed[];
      return list.some((item) => item.id === 'html-viewer');
    }, '内置插件未安装');

    await ctx.evaluate(async () => {
      await window.workStudio.command('plugin', 'installed', 'open', {
        id: 'html-viewer',
      });
    });
    const page = await ctx.waitForPage(/html-viewer/);
    await page.expect.text('body', '.html');

    await ctx.evaluate(async () => {
      await window.workStudio.command('plugin', 'installed', 'reload', {
        id: 'html-viewer',
      });
    });
    await ctx.expect.poll(async () => {
      const list = (await ctx.evaluate(() =>
        window.workStudio.subscribe('plugin', 'installed'),
      )) as Installed[];
      return list.some(
        (item) => item.id === 'html-viewer' && item.stage === 'ready',
      );
    }, '插件重载后未回到 ready');
  },
});
