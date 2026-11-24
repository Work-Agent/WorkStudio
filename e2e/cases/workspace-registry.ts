import { defineCase } from '../runner/contract.ts';

interface Registry {
  current?: { id: string; path: string } | null;
  workspaces?: Array<{ id: string; path: string }>;
}

export default defineCase({
  id: 'workspace.registry',
  title: '工作区注册表提供当前项与列表',
  tags: ['dev', 'ci'],
  async run(ctx) {
    await ctx.expect.poll(async () => {
      const registry = (await ctx.evaluate(() =>
        window.workStudio.subscribe('workspace', 'registry'),
      )) as Registry;
      return Boolean(
        registry.current?.id &&
        registry.workspaces?.some((item) => item.id === registry.current?.id),
      );
    }, '工作区注册表未就绪');
  },
});
