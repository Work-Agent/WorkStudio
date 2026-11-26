import { defineCase } from '../runner/contract.ts';

interface Provider {
  id: string;
}

interface CommandResult {
  ok: boolean;
  error?: { message: string };
}

/** 大厂登录只走主进程：页面没有注入入口，快照也不带凭证。 */
export default defineCase({
  id: 'agent.oauth',
  title: '登录只经主进程：没有页面注入入口，快照不含凭证',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const providers = (await ctx.evaluate(() =>
        window.workStudio.subscribe('agent', 'providers'),
      )) as Provider[] | null;
      return Boolean(providers?.length);
    }, '模型供应商目录为空');

    // 页面注入入口已移除（凭证只能由主进程的回调流程写入）。
    const inject = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'providers', 'completeLogin', {
        providerId: 'simbalink',
        accessToken: 'e2e-token',
      }),
    )) as CommandResult;
    if (inject.ok) throw new Error('页面注入入口仍然存在');

    // 未知供应商不能打开登录页。
    const unknown = (await ctx.evaluate(() =>
      window.workStudio.command('agent', 'providers', 'openLogin', {
        providerId: 'e2e-not-a-provider',
      }),
    )) as CommandResult;
    if (unknown.ok || !/未知供应商/.test(unknown.error?.message ?? '')) {
      throw new Error(
        `未知 provider 未被拒绝：${unknown.ok ? 'ok' : unknown.error?.message}`,
      );
    }

    // 供应商投影里不出现任何凭证字段。
    const exposed = (await ctx.evaluate(async () => {
      const providers = (await window.workStudio.subscribe(
        'agent',
        'providers',
      )) as Array<Record<string, unknown>>;
      const keys = new Set<string>();
      for (const provider of providers) {
        for (const key of Object.keys(provider)) keys.add(key);
      }
      return [...keys].filter((key) => /token|secret|apikey/i.test(key));
    })) as string[];
    if (exposed.length > 0) {
      throw new Error(`providers 快照暴露了凭证字段：${exposed.join(', ')}`);
    }
  },
});
