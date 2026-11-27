import { defineCase } from '../runner/contract.ts';
import { ensureFixturePlugin } from '../support/plugin-fixture.ts';

interface ProbeResult {
  ok: boolean;
  data?: { undeclared?: string; unknownProvider?: string };
  error?: { message: string };
}

export default defineCase({
  id: 'agent.credentials',
  title: '插件写凭证受清单白名单与 provider 存在性双重限制',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureFixturePlugin(ctx, 'probe-host');

    const result = (await ctx.evaluate(() =>
      window.workStudio.command(
        'probe-host',
        'probe-host',
        'credentialProbe',
        {},
      ),
    )) as ProbeResult;
    if (!result.ok) {
      throw new Error(`探针命令失败：${result.error?.message}`);
    }

    const undeclared = result.data?.undeclared ?? '';
    if (!/未声明凭证权限/.test(undeclared)) {
      throw new Error(`未声明的 provider 未被拒绝：${undeclared}`);
    }

    const unknown = result.data?.unknownProvider ?? '';
    if (!/未知供应商/.test(unknown)) {
      throw new Error(`不存在的 provider 未被拒绝：${unknown}`);
    }
  },
});
