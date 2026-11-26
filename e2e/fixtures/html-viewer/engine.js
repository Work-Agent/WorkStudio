/** HTML 阅读器动态贡献：资源适配器 + 读取/保存命令。 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** 激活作用域：密钥探针用（命令上下文不含 secrets）。 */
let scope = null;

async function readHtml(ref) {
  const text = await readFile(fileURLToPath(ref), 'utf-8');
  return [{ locator: ref, title: 'HTML', text }];
}

export const workstudio = {
  lifecycle: {
    activate(next) {
      scope = next;
    },
    deactivate() {
      scope = null;
    },
  },
  resources: {
    html: {
      read: readHtml,
    },
  },
  commands: {
    'html-viewer.read': {
      summary: '读取 HTML 内容',
      args: {
        ref: { type: 'string', required: true },
      },
      async run(input) {
        return readHtml(String(input.ref));
      },
    },
    'html-viewer.save': {
      summary: '保存 HTML 内容',
      args: {
        ref: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      async run(input, ctx) {
        await ctx.fs.write(
          String(input.ref),
          new TextEncoder().encode(String(input.content)),
        );
        ctx.changed(String(input.ref), 'content');
        return { saved: true };
      },
    },
    // 密钥域探针：验证插件只能读写自己的域。
    'html-viewer.secret': {
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
        return { value: await scope.secrets.get(key) };
      },
    },
    // 凭证能力探针：验证「清单白名单 + provider 存在性」两层限制。
    'html-viewer.credentialProbe': {
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
          await ctx.credentials.write('html-viewer-probe', {
            accessToken: 'e2e-probe',
          });
          result.unknownProvider = 'allowed';
        } catch (error) {
          result.unknownProvider = String(error?.message ?? error);
        }
        return result;
      },
    },
  },
};
