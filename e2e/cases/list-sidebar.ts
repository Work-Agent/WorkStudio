import { defineCase } from '../runner/contract.ts';

interface Snapshot {
  groups?: Array<{
    id: string;
    section?: string;
    items: Array<{ title: string }>;
  }>;
}

interface TreeView {
  groups: string[];
  items: string[];
}

export default defineCase({
  id: 'list.sidebar',
  title: '侧栏资源树绑定本窗口的工作区列表',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const expected = await ctx.evaluate(async () => {
      const workspaceId = window.workStudio.workspaceId;
      if (!workspaceId) throw new Error('窗口未绑定工作区');
      const snapshot = (await window.workStudio.subscribe(
        'workspace',
        `${workspaceId}/list`,
      )) as Snapshot | null;
      const groups = (snapshot?.groups ?? []).filter(
        (group) => (group.section ?? 'resources') === 'resources',
      );
      return {
        groupIds: groups.map((group) => group.id),
        titles: groups.flatMap((group) =>
          group.items.map((item) => item.title),
        ),
      };
    });

    await ctx.expect.poll(async () => {
      const view = (await ctx.evaluate(() => {
        const tree = document.querySelector('[role="tree"]');
        if (!tree) return null;
        tree
          .querySelectorAll('[data-testid="sidebar-tree-dir"]')
          .forEach((node) => {
            const collapsed =
              node.parentElement?.getAttribute('aria-expanded') === 'false';
            if (collapsed) (node as HTMLElement).click();
          });
        return {
          groups: [
            ...tree.querySelectorAll('[data-testid="sidebar-tree-group"]'),
          ].map((node) => node.getAttribute('data-group') ?? ''),
          items: [
            ...tree.querySelectorAll('[data-testid="sidebar-tree-item"]'),
          ].map((node) => node.getAttribute('title') ?? ''),
        };
      })) as TreeView | null;
      if (!view) return false;
      if (view.groups.join() !== expected.groupIds.join()) return false;
      return expected.titles.every((title) => view.items.includes(title));
    }, '侧栏资源树与工作区列表不一致');
  },
});
