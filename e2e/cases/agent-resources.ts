import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'agent.resources',
  title: 'agent 子 domain 的扩展 / 工具 / 提示词 / 主题可订阅',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(
      () =>
        ctx.evaluate(async () => {
          const [extensions, tools, prompts, themes] = await Promise.all([
            window.workStudio.subscribe('extensions', 'list'),
            window.workStudio.subscribe('tools', 'list'),
            window.workStudio.subscribe('prompts', 'list'),
            window.workStudio.subscribe('themes', 'list'),
          ]);
          return [extensions, tools, prompts, themes].every(Array.isArray);
        }),
      'agent 资源 domain 未就绪',
    );
  },
});
