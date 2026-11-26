import { defineCase } from '../runner/contract.ts';

interface CommandResult {
  ok: boolean;
  data?: unknown;
  error?: { message: string };
}

/** 只跑真实流程：登录页是供应商自己的页面，不再有模拟页。 */
export default defineCase({
  id: 'agent.login-page',
  title: '快捷登录在应用内标签页打开供应商登录页',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const opened = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'providers', 'openLogin', {
        providerId: 'simbalink',
      }),
    )) as CommandResult;
    if (!opened.ok) throw new Error(`openLogin 失败：${opened.error?.message}`);
    if (opened.data !== 'https://titan-token.simbalink.cn/login') {
      throw new Error(`登录页地址不对：${String(opened.data)}`);
    }

    const page = await ctx.waitForPage(/titan-token\.simbalink\.cn\/login/);
    if (!page.url().startsWith('https://titan-token.simbalink.cn/login')) {
      throw new Error(`标签页地址不对：${page.url()}`);
    }

    // 没声明 loginUrl 的供应商（内置 OAuth）不能走页面流程。
    const builtin = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'providers', 'openLogin', {
        providerId: 'anthropic',
      }),
    )) as CommandResult;
    if (builtin.ok || !/没有登录页/.test(builtin.error?.message ?? '')) {
      throw new Error(
        `内置供应商不应走页面登录：${builtin.ok ? 'ok' : builtin.error?.message}`,
      );
    }
  },
});
