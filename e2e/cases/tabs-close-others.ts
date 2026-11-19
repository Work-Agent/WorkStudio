import { defineCase } from '../runner/contract.ts';
import { parsePopupAction } from '../../src/shared/popup-action.ts';

interface ViewInfo {
  id: string;
  type: string;
  title: string;
  active: boolean;
}

interface TabList {
  list: ViewInfo[];
}

/**
 * 关闭其他的集合语义（主进程）：
 *   ① 锚点存在 → 只留锚点并激活；
 *   ② 锚点不存在 → 原样返回，不能退化成「关闭全部」。
 */
export default defineCase({
  id: 'tabs.close-others',
  title: '关闭其他保留锚点，未知锚点不误删',
  tags: ['dev', 'ci'],
  async run(ctx) {
    // 菜单动作 id 的锚点含冒号（view id = wsId:web-N）：不能被截断。
    const parsed = parsePopupAction('closeOthers:6a42abb4a148:web-2');
    if (
      parsed.action !== 'closeOthers' ||
      parsed.value !== '6a42abb4a148:web-2'
    ) {
      throw new Error(`菜单锚点解析错误：${JSON.stringify(parsed)}`);
    }

    await ctx.legacyBridge.call('/settings/open', { pageId: 'appearance' });
    const workspace = await ctx.legacyBridge.peek<{ id: string }>(
      '/workspaces/current',
    );
    if (!workspace) throw new Error('workspace not ready');
    await ctx.legacyBridge.call(`/workspaces/${workspace.id}/sites/web/open`, {
      url: 'data:text/html,<h1>KEEP</h1>',
      title: 'KEEP',
    });
    await ctx.expect.poll(
      async () =>
        ((await ctx.legacyBridge.peek<ViewInfo[]>('/views'))?.length ?? 0) >= 2,
      '关闭其他前标签不足',
    );

    await ctx.evaluate(async () => {
      const bridge = window.workStudio;
      const ws = (await bridge.subscribe('workspaces', 'current')) as {
        id: string;
      };
      const before = (await bridge.subscribe('tabs', ws.id)) as TabList;
      const anchor = before.list.find((view) => view.type === 'web');
      if (!anchor) throw new Error('网页标签不存在');

      // 未知锚点：不允许退化成关闭全部
      await bridge.command('tabs', ws.id, 'closeOthers', ws.id);
      const afterUnknown = (await bridge.subscribe('tabs', ws.id)) as TabList;
      if (afterUnknown.list.length !== before.list.length) {
        throw new Error('未知锚点误删了标签');
      }

      // 正确锚点：只保留它并激活
      await bridge.command('tabs', ws.id, 'closeOthers', anchor.id);
      const after = (await bridge.subscribe('tabs', ws.id)) as TabList;
      if (after.list.length !== 1 || after.list[0]?.id !== anchor.id) {
        throw new Error(
          `关闭其他未保留锚点：${after.list.map((view) => view.id).join(',')}`,
        );
      }
      if (!after.list[0]?.active) throw new Error('保留的标签未激活');
    });
  },
});
