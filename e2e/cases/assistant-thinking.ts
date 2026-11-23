import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'assistant.thinking',
  title: '助手 thinking levels 来自 thinking domain',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const assistant = await ctx.waitForPage(
      /^(work:\/\/studio\/assistant|.*pages\/assistant\/index\.html)/,
    );
    await ctx.expect.poll(async () => {
      const levels = (await assistant.evaluate(async () => {
        const state = (await window.workStudio.subscribe(
          'thinking',
          'current',
        )) as { levels?: string[] } | null;
        return state?.levels ?? [];
      })) as string[];
      return Array.isArray(levels) && levels.length > 0;
    }, 'thinking levels 为空');
  },
});
