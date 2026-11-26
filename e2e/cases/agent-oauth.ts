import { defineCase } from '../runner/contract.ts';
import { ensureHtmlFixture } from '../support/plugin-fixture.ts';

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

const PROVIDER = 'openai-codex';

export default defineCase({
  id: 'agent.oauth',
  title: '授权页一步交回凭证：校验 provider 存在，凭证只进主进程',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureHtmlFixture(ctx);
    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      return Boolean(providers?.length);
    }, '模型供应商目录为空');

    // 后端校验 provider 是否存在：不存在的 provider 直接拒绝。
    const unknown = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'providers', 'completeLogin', {
        providerId: 'e2e-not-a-provider',
        accessToken: 'e2e-token',
      }),
    )) as CommandResult;
    if (unknown.ok || !/未知供应商/.test(unknown.error?.message ?? '')) {
      throw new Error(
        `未知 provider 未被拒绝：${unknown.ok ? 'ok' : unknown.error?.message}`,
      );
    }

    // 一步提交：accessToken + refreshToken + expiresIn → 存为 oauth 凭证。
    const submitted = (await ctx.evaluate(
      (providerId) =>
        window.workStudio.command(
          'agent',
          `provider/${providerId}`,
          'completeLogin',
          {
            accessToken: 'e2e-access-token',
            refreshToken: 'e2e-refresh-token',
            expiresIn: 3600,
          },
        ),
      PROVIDER,
    )) as CommandResult;
    if (!submitted.ok) {
      throw new Error(`completeLogin 失败：${submitted.error?.message}`);
    }

    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      const provider = providers?.find((item) => item.id === PROVIDER);
      return provider?.configured === true && provider.authType === 'oauth';
    }, '凭证提交后 provider 未变成已登录（oauth）');

    // 快照与命令返回值都不携带凭证值。
    const leaked = (await ctx.evaluate(async () => {
      const providers = await window.workStudio.subscribe('agent', 'providers');
      const snapshot = JSON.stringify(providers);
      return (
        snapshot.includes('e2e-access-token') ||
        snapshot.includes('e2e-refresh-token')
      );
    })) as boolean;
    if (leaked) throw new Error('providers 快照泄露了凭证值');

    // 退出登录后回到未配置。
    const logout = (await ctx.evaluate(
      (providerId) =>
        window.workStudio.command(
          'agent',
          `provider/${providerId}`,
          'logout',
          {},
        ),
      PROVIDER,
    )) as CommandResult;
    if (!logout.ok) throw new Error(`logout 失败：${logout.error?.message}`);

    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      const provider = providers?.find((item) => item.id === PROVIDER);
      return Boolean(provider && !provider.configured);
    }, '退出登录后 provider 仍处于已配置状态');
  },
});
