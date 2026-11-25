import { defineCase } from '../runner/contract.ts';

interface Aggregate {
  current?: { sessionFile?: string | null } | null;
}

interface SessionView {
  sessionId?: string;
  workspaceId?: string;
}

export default defineCase({
  id: 'agent.sessions-concurrent',
  title: '一个工作区内多个会话各自持有 agent 资源',
  tags: ['ci', 'mutating'],
  async run(ctx) {
    const workspaceId = await ctx.evaluate(() => window.workStudio.workspaceId);
    if (!workspaceId) throw new Error('窗口未绑定工作区');

    const files = (await ctx.evaluate(async (id) => {
      const created: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const result = await window.workStudio.command<Aggregate>(
          'agent',
          `${id}/sessions`,
          'new',
        );
        if (!result.ok) throw new Error(result.error.message);
        const file = result.data.current?.sessionFile ?? '';
        if (!file) throw new Error('新会话没有会话文件');
        created.push(file);
      }
      return created;
    }, workspaceId)) as string[];

    if (new Set(files).size !== 2) throw new Error('两次新建复用了同一会话');

    const views = (await ctx.evaluate(
      async (input) => {
        const { workspaceId: id, files: paths } = input as {
          workspaceId: string;
          files: string[];
        };
        return Promise.all(
          paths.map(async (file) => {
            const key = encodeURIComponent(file);
            return (await window.workStudio.subscribe(
              'agent',
              `${id}/session/${key}`,
            )) as SessionView | null;
          }),
        );
      },
      { workspaceId, files },
    )) as Array<SessionView | null>;

    if (views.some((view) => !view)) {
      throw new Error('多个会话没有各自建立 agent 资源');
    }
    const ids = views.map((view) => view?.sessionId);
    if (new Set(ids).size !== ids.length) throw new Error('会话地址重复');
  },
});
