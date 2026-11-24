import { defineCase } from '../runner/contract.ts';
import { parsePopupAction } from '../../src/shared/popup-action.ts';

interface ViewInfo {
  id: string;
  type: string;
  title: string;
  active: boolean;
}

export default defineCase({
  id: 'tabs.close-others',
  title: '关闭其他保留锚点，未知锚点不误删',
  tags: ['dev', 'ci'],
  async run(ctx) {
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
      const before = (await bridge.subscribe('shell', 'views')) as ViewInfo[];
      const anchor = before.find((view) => view.type === 'web');
      if (!anchor) throw new Error('网页标签不存在');

      await bridge.command('shell', 'views', 'closeOthers', {
        id: 'missing-anchor',
      });
      const afterUnknown = (await bridge.subscribe(
        'shell',
        'views',
      )) as ViewInfo[];
      if (afterUnknown.length !== before.length) {
        throw new Error('未知锚点误删了标签');
      }

      await bridge.command('shell', 'views', 'closeOthers', {
        id: anchor.id,
      });
      const after = (await bridge.subscribe('shell', 'views')) as ViewInfo[];
      if (after.length !== 1 || after[0]?.id !== anchor.id) {
        throw new Error(
          `关闭其他未保留锚点：${after.map((view) => view.id).join(',')}`,
        );
      }
      if (!after[0]?.active) throw new Error('保留的标签未激活');
    });
  },
});
