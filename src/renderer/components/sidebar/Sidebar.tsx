/**
 * S2 左栏 Sidebar（Phase 4）—— 列表宿主。
 *
 * 结构由主进程 ListService 给出；渲染层只按 sidebarView 过滤 ListSnapshot，
 * 不再写死 docs / web / 临时网页分组。
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '../../state/workspace';
import { useUiStore } from '../../state/ui';
import { FindList } from './FindList';
import { ListHost } from './ListHost';
import { SidebarNav } from './SidebarNav';

export function Sidebar() {
  const view = useUiStore((s) => s.sidebarView);
  const groups = useWorkspaceStore((s) => s.groups);
  const init = useWorkspaceStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  const section =
    view === 'plugins'
      ? 'plugins'
      : view === 'settings'
        ? 'settings'
        : 'resources';
  const visible = groups.filter((group) => group.section === section);

  return (
    <div className="flex h-full w-full" data-testid="sidebar">
      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-[#1A1C1D] min-w-0">
        <SidebarNav />
        <div className="flex-1 overflow-y-auto px-1 py-1">
          {view === 'find' ? <FindList /> : <ListHost groups={visible} />}
        </div>
      </div>
    </div>
  );
}
