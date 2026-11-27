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
    // 取数面与助手工具同一契约：页面也有 ls / find / read / grep。
    const access = await assistant.evaluate(() =>
      ['ls', 'find', 'read', 'grep'].every(
        (name) =>
          typeof (window.workStudio as unknown as Record<string, unknown>)[
            name
          ] === 'function',
      ),
    );
    if (!access) throw new Error('页面 bridge 缺少取数面');
    const listed = await assistant.evaluate(async () => {
      const registry = (await window.workStudio.subscribe(
        'workspace',
        'registry',
      )) as { current?: { path?: string } };
      const root = 'file://' + (registry.current?.path ?? '/');
      const entries = await window.workStudio.ls(root);
      return Array.isArray(entries) ? entries.length : -1;
    });
    if (listed < 0) throw new Error('页面 ls 失败');
    const ok = await assistant.evaluate(async () => {
      const state = (await window.workStudio.subscribe('agent', 'skills')) as {
        catalog?: unknown[];
      } | null;
      return Array.isArray(state?.catalog);
    });
    if (!ok) throw new Error('技能资源不可用');
  },
});
