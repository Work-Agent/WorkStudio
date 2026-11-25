/** HTML 阅读器动态贡献：资源适配器 + 读取/保存命令。 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function readHtml(ref) {
  const text = await readFile(fileURLToPath(ref), 'utf-8');
  return [{ locator: ref, title: 'HTML', text }];
}

export const workstudio = {
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
  },
};
