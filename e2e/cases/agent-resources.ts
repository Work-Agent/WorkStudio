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
          names: Array.isArray(tools)
            ? tools.map((tool) => String(tool?.name ?? ''))
            : [],
          prompts: Array.isArray(prompts),
          themes: Array.isArray(themes),
        };
      });
      // 基础工具：取数面四个 + 打开 + 写通道。
      const basic = ['ls', 'find', 'read', 'grep', 'open', 'bash'];
      const removed = ['command', 'command_list', 'write', 'edit'];
      return (
        typeof result.extensions === 'object' &&
        result.extensions !== null &&
        result.tools &&
        basic.every((name) => result.names.includes(name)) &&
        !removed.some((name) => result.names.includes(name)) &&
        result.prompts &&
        result.themes
      );
    }, 'agent 资源未就绪');
  },
});
