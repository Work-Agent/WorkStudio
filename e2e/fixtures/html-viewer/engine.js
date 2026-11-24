/** HTML 阅读器动态贡献：资源适配器 + 保存命令。 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const workstudio = {
  resources: {
    html: {
      async read(ref) {
        const text = await readFile(fileURLToPath(ref), 'utf-8');
        return [{ locator: ref, title: 'HTML', text }];
      },
    },
  },
  commands: {
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
