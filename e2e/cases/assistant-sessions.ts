import { defineCase } from '../runner/contract.ts';

export default defineCase({
  id: 'assistant.sessions',
  title: '助手会话聚合提供 current / items / stream / opened',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const state = (await ctx.evaluate(() =>
        window.workStudio.subscribe(
          'agent',
          `${String(window.workStudio.workspaceId)}/sessions`,
        ),
      )) as {
        current?: unknown;
        items?: unknown[];
        active?: { messages?: unknown[]; stream?: { tools?: unknown[] } };
        opened?: unknown[];
        thinking?: { levels?: unknown[] };
      } | null;
      return Boolean(
        state &&
        state.current &&
        Array.isArray(state.items) &&
        Array.isArray(state.active?.messages) &&
        Array.isArray(state.active?.stream?.tools) &&
        Array.isArray(state.opened) &&
        Array.isArray(state.thinking?.levels),
      );
    }, '会话聚合形状不完整');
  },
});
