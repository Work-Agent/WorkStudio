import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'assistant.bridge',
  title: '助手视图使用 workStudio 并读取技能资源',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const assistant = await ctx.waitForPage(
      /^(work:\/\/studio\/assistant|.*pages\/assistant\/index\.html)/,
    );
    await ctx.expect.poll(
      async () =>
        assistant.evaluate(
          () =>
            typeof window.workStudio?.subscribe === 'function' &&
            typeof window.__e2eBridge === 'undefined',
        ),
      '助手没有使用 workStudio',
    );
    const ok = await assistant.evaluate(async () => {
      const state = (await window.workStudio.subscribe('agent', 'skills')) as {
        catalog?: unknown[];
      } | null;
      return Array.isArray(state?.catalog);
    });
    if (!ok) throw new Error('技能资源不可用');
  },
});
