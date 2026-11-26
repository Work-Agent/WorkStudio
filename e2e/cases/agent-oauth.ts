import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

interface Provider {
  id: string;
}

interface CommandResult {
  ok: boolean;
  data?: { state?: string };
  error?: { message: string };
}

export default defineCase({
  id: 'agent.oauth',
  title: '插件页可通过 bridge 在 provider 资源上开始 OAuth',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      return Boolean(providers?.length);
    }, '模型供应商目录为空');

    await ctx.evaluate(async () => {
      const id = window.workStudio.workspaceId;
      if (!id) return;
      await window.workStudio.command('shell', `${id}/views`, 'open', {
        id: 'plugin:html-viewer:settings',
        type: 'page',
        title: 'HTML 设置',
        url: 'plugin://html-viewer/settings',
      });
    });
    const page = await ctx.waitForPage(/html-viewer\/settings/);
    const result = (await page.evaluate(async () => {
      const providers = (await window.workStudio.subscribe(
        'agent',
        'providers',
      )) as Provider[];
      const provider = providers[0];
      if (!provider) throw new Error('没有供应商');
      return window.workStudio.command(
        'agent',
        `provider/${encodeURIComponent(provider.id)}`,
        'beginOAuth',
        {},
      );
    })) as CommandResult;

    if (!result.ok || !result.data?.state) {
      throw new Error(
        `provider beginOAuth 未返回 state：${result.error?.message ?? 'unknown'}`,
      );
    }
  },
});
