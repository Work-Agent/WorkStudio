/**
 * S2 左栏 Sidebar —— 资源树 + 插件列表。
 *
 * 资源（本地文档 / 网站域 / 临时网页）以树状展示：分组为根节点，
 * 本地文档继续按目录展开；插件保持「分组 → 列表」方式；设置入口在 TitleBar。
 */
import { useEffect } from 'react';
import { FileText, Globe } from 'lucide-react';
import type { ListItem } from '../../../../../shared/lists.ts';
import { command } from '../../../../shared/api/bridge.ts';
import { openListItem, useLists } from '../../../../shared/domains/lists.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useScene } from '../../domains/scene.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';
import { useActiveWorkspaceId } from '../../domains/windows.ts';
import { FindList } from './FindList.tsx';
import { GroupDetail } from './GroupDetail.tsx';
import { GroupRow } from './GroupRow.tsx';
import { groupIconOf } from './groupIcon.ts';
import { OpenItem } from './OpenItem.tsx';
import { ResourceTree } from './ResourceTree.tsx';
import { SidebarNav } from './SidebarNav.tsx';

async function openItem(item: ListItem): Promise<void> {
  try {
    await openListItem(item);
  } catch (error) {
    notifyError(error instanceof Error ? error.message : String(error), 'open');
  }
}

async function closeItem(item: ListItem, wsId: string | null): Promise<void> {
  const viewId = item.meta?.['viewId'];
  if (typeof viewId === 'string' && wsId) {
    await command('shell', `tabs:${wsId}`, 'close', viewId).catch(
      () => undefined,
    );
  }
}

export function Sidebar() {
  const view = useSidebarStore((s) => s.view);
  const groupId = useSidebarStore((s) => s.group);
  const setView = useSidebarStore((s) => s.setView);
  const setGroup = useSidebarStore((s) => s.setGroup);
  const { scene } = useScene();
  const collapsed = scene.sidebarCollapsed ?? false;
  const groups = useLists();
  const wsId = useActiveWorkspaceId();

  useEffect(() => {
    if (
      groupId !== null &&
      (view === 'plugins' || view === 'settings' || view === 'find')
    ) {
      setGroup(null);
    }
  }, [view, groupId, setGroup]);

  const section = view === 'plugins' ? 'plugins' : 'resources';
  const visible = groups.filter((group) => group.section === section);
  const activeGroup =
    groupId !== null
      ? visible.find((group) => group.id === groupId)
      : undefined;
  const resourceView = view !== 'plugins' && view !== 'find';

  return (
    <div className="flex h-full w-full" data-testid="sidebar">
      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-[#1A1C1D] min-w-0">
        <SidebarNav />
        <div className="flex-1 overflow-y-auto px-1 py-1 space-y-1">
          {view === 'find' ? (
            <FindList />
          ) : resourceView && !collapsed ? (
            <ResourceTree groups={visible} />
          ) : resourceView && activeGroup ? (
            <GroupDetail group={activeGroup} onBack={() => setGroup(null)} />
          ) : resourceView ? (
            visible.map((group) => {
              const { Icon, iconUrl } = groupIconOf(group);
              const openItems = group.items.filter(
                (item) => item.itemType !== 'link' && item.state?.open === true,
              );
              return (
                <GroupRow
                  key={group.id}
                  title={group.label}
                  icon={Icon}
                  iconUrl={iconUrl}
                  groupKey={group.id}
                  bg={
                    group.tone ??
                    'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100'
                  }
                  count={group.count}
                  countLabel={group.countLabel}
                  latest={group.updatedAt}
                  onClick={() => setGroup(group.id)}
                  activeRow={
                    openItems.length > 0
                      ? openItems.map((item) => (
                          <OpenItem
                            key={item.key}
                            testId="doc-open-item"
                            icon={
                              item.meta?.['source'] === 'web' ? (
                                <Globe className="w-4 h-4" />
                              ) : (
                                <FileText className="w-4 h-4" />
                              )
                            }
                            label={item.title}
                            meta={item.subtitle}
                            active={item.state?.active === true}
                            onClick={() => void openItem(item)}
                            onClose={
                              collapsed
                                ? undefined
                                : () => void closeItem(item, wsId)
                            }
                          />
                        ))
                      : null
                  }
                  collapsed={collapsed}
                />
              );
            })
          ) : visible[0] ? (
            <GroupDetail
              group={visible[0]}
              onBack={() => {
                setView('main');
                setGroup(null);
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
