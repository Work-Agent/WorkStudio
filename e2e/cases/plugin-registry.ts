import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface RegistrySnapshot {
  installed: Array<{ id: string; state: string }>;
  available: Array<{ id: string; state: string }>;
}

export default defineCase({
  id: 'plugin.registry',
  title: '插件注册表在侧栏独立展示已安装与可安装',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe('plugin', 'registry'),
      )) as RegistrySnapshot | null;
      return Boolean(
        state?.installed.some((item) => item.id === 'html-viewer'),
      );
    }, '插件注册表未包含已安装插件');

    await ctx.clickTestId('sidebar-nav-plugins');
    await ctx.expect.poll(
      async () =>
        ctx.evaluate(() =>
          Boolean(
            document.querySelector(
              '[data-testid="plugin-registry"] [data-testid="plugin-registry-installed"]',
            ),
          ),
        ),
      '侧栏插件注册表未渲染已安装项',
    );
    await ctx.clickTestId('plugin-registry-installed');
    const page = await ctx.waitForPage(/html-viewer\/settings/);
    await page.expect.text('body', 'HTML 阅读器');
    await ctx.clickTestId('sidebar-nav-resources');
  },
});
