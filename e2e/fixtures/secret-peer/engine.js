/** 密钥域隔离探针：只通过激活作用域的 secrets 读写自己的域。 */
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
    'secret-peer.secret': {
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
