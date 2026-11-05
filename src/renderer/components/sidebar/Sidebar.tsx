/**
 * S2 左栏 Sidebar —— 资源两级列表 + 插件 / 设置列表。
 *
 * 主列表只渲染分组行（本地文档 / 网站域 / 临时网页），分组下展示已打开项；
 * 点击分组进入二级列表。数据全部来自 ListSnapshot，交互保持原侧栏语义。
 */
import { useEffect } from 'react';
import {
  FileText,
  FolderOpen,
  Globe,
  Hourglass,
  MessagesSquare,
  Package,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ListGroup, ListItem } from '../../../shared/lists';
import { cmd } from '../../api/appCommands';
import { notifyError } from '../../state/notifications';
import { setUiState, useUiStore } from '../../state/ui';
import { useWorkspaceStore } from '../../state/workspace';
import { FindList } from './FindList';
import { GroupDetail } from './GroupDetail';
import { GroupRow } from './GroupRow';
import { OpenItem } from './OpenItem';
import { SidebarNav } from './SidebarNav';

const ICONS: Record<string, LucideIcon> = {
  folder: FolderOpen,
  globe: Globe,
  hourglass: Hourglass,
  messages: MessagesSquare,
  package: Package,
  sliders: Settings,
};

function iconOf(group: ListGroup): { Icon: LucideIcon; iconUrl?: string } {
  const raw = group.icon ?? 'folder';
  if (/^(data:|https?:)/.test(raw)) return { Icon: Globe, iconUrl: raw };
  return { Icon: ICONS[raw] ?? FolderOpen };
}

async function openItem(item: ListItem): Promise<void> {
  const result = await cmd('list.action', { action: 'open', item });
  if (!result.ok) notifyError(result.error.message, 'open');
}

async function closeItem(item: ListItem): Promise<void> {
  const viewId = item.meta?.['viewId'];
  if (typeof viewId === 'string') await cmd('views.close', { id: viewId });
}

export function Sidebar() {
  const view = useUiStore((s) => s.sidebarView);
  const groupId = useUiStore((s) => s.sidebarGroup);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const groups = useWorkspaceStore((s) => s.groups);

  useEffect(() => {
    if (
      groupId !== null &&
      (view === 'plugins' || view === 'settings' || view === 'find')
    ) {
      setUiState({ sidebarGroup: null });
    }
  }, [view, groupId]);

  const section =
    view === 'plugins'
      ? 'plugins'
      : view === 'settings'
        ? 'settings'
        : 'resources';
  const visible = groups.filter((group) => group.section === section);
  const activeGroup =
    groupId !== null
      ? visible.find((group) => group.id === groupId)
      : undefined;
  const resourceView =
    view !== 'plugins' && view !== 'settings' && view !== 'find';

  return (
    <div className="flex h-full w-full" data-testid="sidebar">
      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-[#1A1C1D] min-w-0">
        <SidebarNav />
        <div className="flex-1 overflow-y-auto px-1 py-1 space-y-1">
          {view === 'find' ? (
            <FindList />
          ) : resourceView && activeGroup ? (
            <GroupDetail
              group={activeGroup}
              onBack={() => setUiState({ sidebarGroup: null })}
            />
          ) : resourceView ? (
            visible.map((group) => {
              const { Icon, iconUrl } = iconOf(group);
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
                  onClick={() => setUiState({ sidebarGroup: group.id })}
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
                              collapsed ? undefined : () => void closeItem(item)
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
              onBack={() =>
                setUiState({ sidebarView: 'main', sidebarGroup: null })
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
