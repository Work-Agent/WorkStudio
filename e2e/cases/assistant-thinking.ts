import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'assistant.thinking',
  title: '助手 thinking levels 来自 sessions domain',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const assistant = await ctx.waitForPage(/pages\/assistant\/index\.html/);
    await ctx.expect.poll(async () => {
      const levels = (await assistant.evaluate(async () =>
        window.workStudio.subscribe('sessions', 'thinking'),
      )) as string[];
      return Array.isArray(levels) && levels.length > 0;
    }, 'thinking levels 为空');
  },
});
