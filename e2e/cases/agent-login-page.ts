import { defineCase } from '../runner/contract.ts';

interface Provider {
  id: string;
  configured?: boolean;
  authType?: string;
}

interface CommandResult {
  ok: boolean;
  data?: unknown;
  error?: { message: string };
}

/** 页面登录：打开登录页 → 供应商 302 回本机回调 → 主进程写库。 */
export default defineCase({
  id: 'agent.login-page',
  title: '页面登录经本机回调把凭证写进密钥库',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const providerState = async (): Promise<Provider | undefined> => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      return providers?.find((item) => item.id === 'simbalink');
    };

    // 登录是长任务：只发起，不等待。
    await ctx.evaluate(async () => {
      void window.workStudio
        .command('agent', 'providers', 'openLogin', { providerId: 'simbalink' })
        .catch(() => undefined);
    });

    const page = await ctx.waitForPage(/titan-token\.simbalink\.cn\/login/);
    const url = new URL(page.url());
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    if (!redirectUri || !state) {
      throw new Error(`登录页缺少回调参数：${url.href}`);
    }

    // 模拟供应商登录成功后 302 回本机。
    const callback = new URL(redirectUri);
    callback.searchParams.set('state', state);
    callback.searchParams.set('access_token', 'e2e-page-token');
    callback.searchParams.set('expires_in', '3600');
    const response = await fetch(callback, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`回调失败：${response.status}`);

    await ctx.expect.poll(async () => {
      const provider = await providerState();
      return provider?.configured === true;
    }, '回调后供应商仍未写入凭证');
    await ctx.expect.attribute('titlebar-user', 'data-signed-in', 'true');

    // 清理
    const logout = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'provider/simbalink', 'logout', {}),
    )) as CommandResult;
    if (!logout.ok) throw new Error(`logout 失败：${logout.error?.message}`);

    // 没声明 loginUrl 的供应商不能走页面登录。
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
