/** 边界探针：凭证白名单与密钥域隔离，业务逻辑一律没有。 */
let scope = null;

export const workstudio = {
  lifecycle: {
    activate(next) {
      scope = next;
    },
    deactivate() {
      scope = null;
    },
  },
  resources: {},
  commands: {
    // 清单只声明了 probe-host-provider：别的 provider 与不存在的 provider 都必须被拒。
    'probe-host.credentialProbe': {
      summary: '验证凭证写入受限',
      args: {},
      async run(_input, ctx) {
        const result = {};
        try {
          await ctx.credentials.write('openai-codex', {
            accessToken: 'e2e-probe',
          });
          result.undeclared = 'allowed';
        } catch (error) {
          result.undeclared = String(error?.message ?? error);
        }
        try {
          await ctx.credentials.write('probe-host-provider', {
            accessToken: 'e2e-probe',
          });
          result.unknownProvider = 'allowed';
        } catch (error) {
          result.unknownProvider = String(error?.message ?? error);
        }
        return result;
      },
    },
    'probe-host.secret': {
      summary: '读写本插件密钥域的探针',
      args: {
        action: { type: 'string', required: true },
        value: { type: 'string' },
      },
      async run(input) {
        const key = 'probe-secret';
        if (!scope) throw new Error('插件未激活');
        if (String(input.action) === 'set') {
          await scope.secrets.set(key, String(input.value ?? ''));
        }
        if (String(input.action) === 'clear') {
          await scope.secrets.set(key, null);
        }
        return { value: await scope.secrets.get(key) };
      },
    },
  },
};
