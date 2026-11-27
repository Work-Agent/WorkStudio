import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineCase } from '../runner/contract.ts';

interface ViewInfo {
  id: string;
  title: string;
  url?: string;
  active: boolean;
}

/** 关掉当前标签后应该接右邻（没有右邻接左邻），不是回欢迎页。 */
export default defineCase({
  id: 'tabs.identity',
  title: '同一资源只有一个标签，关闭后接相邻标签',
  tags: ['dev', 'ci', 'mutating'],
  async run(ctx) {
    const workspace = (await ctx.evaluate(() =>
      window.workStudio.subscribe('workspace', 'registry'),
    )) as { current?: { path?: string; id?: string } | null };
    const root = workspace.current?.path;
    if (!root) throw new Error('没有当前工作区');
    // 中文文件名：同一文件有两种合法 ref 写法（裸 UTF-8 与百分号编码）。
    const file = join(root, '前赤壁赋-tab.txt');
    const views = (): Promise<ViewInfo[] | null> =>
      ctx.evaluate(() =>
        window.workStudio.subscribe(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
        ),
      ) as Promise<ViewInfo[] | null>;

    const open = async (ref: string): Promise<void> => {
      await ctx.evaluate(async (target) => {
        await window.workStudio.command(
          'workspace',
          `${String(window.workStudio.workspaceId)}/resources`,
          'action',
          {
            action: 'open',
            node: {
              key: target,
              type: 'file',
              title: 'TAB',
              meta: { ref: target },
            },
          },
        );
      }, ref);
    };

    try {
      writeFileSync(file, 'tab identity\n');
      const encoded = pathToFileURL(file).toString();
      const raw = `file://${file}`;
      if (encoded === raw) throw new Error('文件名没有触发编码差异');

      await open(encoded);
      await open(raw);

      const matches = (await views())?.filter((view) =>
        String(view.url ?? '').includes('text-editor'),
      );
      if ((matches?.length ?? 0) !== 1) {
        throw new Error(
          `同一文件开了 ${matches?.length ?? 0} 个标签：${matches
            ?.map((view) => view.url)
            .join(' | ')}`,
        );
      }

      // 右边没有标签时，关掉当前页应回到左边的设置页，而不是欢迎页。
      await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
      const list = (await views()) ?? [];
      const settings = list.find((view) =>
        String(view.url).includes('settings'),
      );
      const tab = list.find((view) => String(view.url).includes('text-editor'));
      if (!settings || !tab) throw new Error('标签不完整');
      await ctx.evaluate(async (id) => {
        await window.workStudio.command(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
          'activate',
          { id },
        );
      }, tab.id);
      await ctx.evaluate(async (id) => {
        await window.workStudio.command(
          'shell',
          `${String(window.workStudio.workspaceId)}/views`,
          'close',
          { id },
        );
      }, tab.id);
      await ctx.expect.poll(async () => {
        const current = (await views())?.find((view) => view.active);
        return Boolean(current && String(current.url).includes('settings'));
      }, '关闭标签后没有接到相邻标签');
    } finally {
      rmSync(file, { force: true });
    }
  },
});
