import { defineCase } from '../runner/contract.ts';
import { ensureFixturePlugin } from '../support/plugin-fixture.ts';

interface SecretResult {
  ok: boolean;
  data?: { value?: string | null };
  error?: { message: string };
}

interface ProbeInput {
  pluginId: string;
  action: 'set' | 'get' | 'clear';
  value?: string;
}

/** 调插件自己的密钥探针命令。 */
function probe(
  ctx: Parameters<Parameters<typeof defineCase>[0]['run']>[0],
  input: ProbeInput,
): Promise<SecretResult> {
  return ctx.evaluate(async (raw) => {
    const args = raw as ProbeInput;
    return (await window.workStudio.command(
      args.pluginId,
      args.pluginId,
      'secret',
      {
        action: args.action,
        ...(typeof args.value === 'string' ? { value: args.value } : {}),
      },
    )) as SecretResult;
  }, input) as Promise<SecretResult>;
}

export default defineCase({
  id: 'agent.secret-domains',
  title: '插件密钥按域隔离：只能读写自己的域',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ensureFixturePlugin(ctx, 'probe-host');
    await ensureFixturePlugin(ctx, 'secret-peer');

    // 密钥域会跨轮保留：先清干净，否则上一轮的写入会把隔离断言弄假。
    for (const pluginId of ['probe-host', 'secret-peer']) {
      await probe(ctx, { pluginId, action: 'clear' });
    }

    const setOwn = await probe(ctx, {
      pluginId: 'probe-host',
      action: 'set',
      value: 'owner-A',
    });
    if (!setOwn.ok || setOwn.data?.value !== 'owner-A') {
      throw new Error(
        `插件写自己的域失败：${setOwn.error?.message ?? 'empty'}`,
      );
    }

    // 另一个插件读同名 key：拿不到别人的值。
    const crossRead = await probe(ctx, {
      pluginId: 'secret-peer',
      action: 'get',
    });
    if (!crossRead.ok || crossRead.data?.value !== null) {
      throw new Error(
        `跨域读取未被隔离：${String(crossRead.data?.value ?? crossRead.error?.message)}`,
      );
    }

    // 另一个插件写同名 key：互不覆盖。
    const setOther = await probe(ctx, {
      pluginId: 'secret-peer',
      action: 'set',
      value: 'owner-B',
    });
    if (!setOther.ok || setOther.data?.value !== 'owner-B') {
      throw new Error(`第二个插件写自己的域失败：${setOther.error?.message}`);
    }
    const ownRead = await probe(ctx, {
      pluginId: 'probe-host',
      action: 'get',
    });
    if (!ownRead.ok || ownRead.data?.value !== 'owner-A') {
      throw new Error(`跨域写入覆盖了别人的值：${String(ownRead.data?.value)}`);
    }
  },
});
