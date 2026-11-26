import { defineCase } from '../runner/contract.ts';

interface ProviderProbe {
  id: string;
  authTypes: string[];
  loginUrl?: string;
}

interface CommandResult {
  ok: boolean;
  error?: { message: string };
}

export default defineCase({
  id: 'settings.models',
  title: '设置模型卡片读取 agent 供应商与模型目录',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.legacyBridge.call('/settings/open', { pageId: 'models' });
    const page = await ctx.waitForPage(
      /^(work:\/\/studio\/settings|.*pages\/settings\/index\.html)/,
    );
    await ctx.expect.poll(async () => {
      const value = (await page.evaluate(async () => {
        const [providers, models] = await Promise.all([
          window.workStudio.subscribe('agent', 'providers'),
          window.workStudio.subscribe('agent', 'models'),
        ]);
        return {
          providers: Array.isArray(providers) ? providers.length : -1,
          models: Array.isArray(models) ? models.length : -1,
        };
      })) as { providers: number; models: number };
      return value.providers > 0 && value.models > 0;
    }, '模型资源为空');

    // 账号入口：有授权页的供应商置顶，且只登录、不列 API Key 路线。
    const providers = (await page.evaluate(() =>
      window.workStudio.subscribe('agent', 'providers'),
    )) as ProviderProbe[];
    const account = providers[0];
    if (account?.id !== 'simbalink') {
      throw new Error(`账号入口应置顶，实际首位：${account?.id ?? '空'}`);
    }
    if (account.authTypes.join(',') !== 'oauth') {
      throw new Error(`账号入口应只有登录：${account.authTypes.join(',')}`);
    }

    // API Key 路线对这类供应商直接拒绝，不留旁路。
    const apiKey = (await page.evaluate(() =>
      window.workStudio.command(
        'agent',
        'provider/simbalink',
        'configureApiKey',
        {
          apiKey: 'e2e-should-be-rejected',
        },
      ),
    )) as CommandResult;
    if (apiKey.ok || !/只支持登录/.test(apiKey.error?.message ?? '')) {
      throw new Error(
        `API Key 不应写入账号入口：${apiKey.ok ? 'ok' : apiKey.error?.message}`,
      );
    }
  },
});
