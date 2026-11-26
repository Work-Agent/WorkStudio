import { defineCase } from '../runner/contract.ts';

interface Snapshot {
  groups?: Array<{
    id: string;
    section?: string;
    roots: Array<{ title: string; children?: unknown[] }>;
  }>;
}

interface TreeView {
  groups: string[];
  items: string[];
  text?: string;
}

export default defineCase({
  id: 'list.sidebar',
  title: '侧栏资源树绑定本窗口的工作区列表',
  tags: ['dev', 'ci'],
  async run(ctx) {
    const expected = await ctx.evaluate(async () => {
      const leafTitles = (
        nodes: Array<{ title: string; children?: unknown[] }>,
      ): string[] =>
        nodes.flatMap((node) =>
          node.children?.length
            ? leafTitles(
                node.children as Array<{
                  title: string;
                  children?: unknown[];
                }>,
              )
            : [node.title],
        );
      const workspaceId = window.workStudio.workspaceId;
      if (!workspaceId) throw new Error('窗口未绑定工作区');
      const snapshot = (await window.workStudio.subscribe(
        'workspace',
        `${workspaceId}/resources`,
      )) as Snapshot | null;
      const groups = (snapshot?.groups ?? []).filter(
        (group) => (group.section ?? 'resources') === 'resources',
      );
      return {
        groupIds: groups.map((group) => group.id),
        titles: groups.flatMap((group) =>
          leafTitles(
            group.roots as Array<{ title: string; children?: unknown[] }>,
          ),
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
          text: tree.textContent?.slice(0, 160) ?? '',
        };
      })) as TreeView | null;
      if (!view) return false;
      if (view.groups.join() !== expected.groupIds.join()) {
        throw new Error(
          `groups expected=${expected.groupIds.join(',')} actual=${view.groups.join(',')} tree=${view.text}`,
        );
      }
      const missing = expected.titles.filter(
        (title) => !view.items.includes(title),
      );
      if (missing.length > 0) {
        throw new Error(
          `items missing=${missing.join(',')} actual=${view.items.join(',')}`,
        );
      }
      return true;
    }, '侧栏资源树与工作区列表不一致');
  },
});
