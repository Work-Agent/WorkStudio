import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'agent.resources',
  title: 'agent 子资源：扩展 / 工具 / 提示词 / 主题可订阅',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const result = await ctx.evaluate(async () => {
        const [extensions, tools, prompts, themes] = await Promise.all([
          window.workStudio.subscribe('agent', 'extensions'),
          window.workStudio.subscribe('agent', 'tools'),
          window.workStudio.subscribe('agent', 'prompts'),
          window.workStudio.subscribe('agent', 'themes'),
        ]);
        return {
          extensions,
          tools: Array.isArray(tools),
          commandTool: Array.isArray(tools)
            ? tools.some((tool) => tool?.name === 'command')
            : false,
          prompts: Array.isArray(prompts),
          themes: Array.isArray(themes),
        };
      });
      return (
        typeof result.extensions === 'object' &&
        result.extensions !== null &&
        result.tools &&
        result.commandTool &&
        result.prompts &&
        result.themes
      );
    }, 'agent 资源未就绪');
  },
});
