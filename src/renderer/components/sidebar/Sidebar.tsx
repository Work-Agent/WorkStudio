/**
 * S2 左栏 Sidebar（工作台）—— architecture.md §13.2。
 *
 * 形态路由：主列表（资源分组 + 打开项）/ 二级列表 / 插件列表 / 设置列表。
 * 核心规则：
 *   - 打开 ≠ 当前：展开项渲染全部打开项（tabs 同源），仅当前项高亮
 *   - 按钮语义分层：主列表展开项 × = 关闭标签；二级列表 = 真删除
 *   - 资源分组数据源驱动：无文档的数据源整组隐藏
 *   - 会话导航不在本部分承载：会话列表归设置域「会话管理」页（中栏 tab）
 */
import { useMemo, useState, type ComponentType } from 'react';
import { FileText, FolderOpen, Globe, Hourglass } from 'lucide-react';
import type { DocumentMeta } from '../../../shared/types';
import { useDocumentsStore } from '../../state/documents';
import { useOpenTabsPresentation } from '../../state/openTabs';
import { setUiState, useUiStore } from '../../state/uiState';
import { DocumentList } from './DocumentList';
import { FindList } from './FindList';
import { GroupRow } from './GroupRow';
import { OpenItem } from './OpenItem';
import { PluginList } from './PluginList';
import { SettingsList } from './SettingsList';
import { SidebarNav } from './SidebarNav';
import { TEMP_PAGES_DOMAIN, TEMP_PAGES_TITLE } from './tempPages';

type GroupTarget = 'docs' | 'web';

/** 主列表分组行（web 域分组 = 一个域一行，favicon 作图标）。 */
interface SidebarGroup {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  iconUrl?: string;
  bg: string;
  docs: DocumentMeta[];
  target: GroupTarget;
  countLabel?: string;
  domain?: string;
}

export function Sidebar() {
  const view = useUiStore((s) => s.sidebarView);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);

  const documents = useDocumentsStore((s) => s.documents);
  const groupsData = useDocumentsStore((s) => s.groups);

  const { openDocs, tempTabs, activeDocId } = useOpenTabsPresentation();

  // ── 分组（URA 资源按 source 分组；web 按域二级分组） ──
  const localDocs = useMemo(
    () => documents.filter((d) => d.source === 'local' && d.type === 'content'),
    [documents],
  );
  const webDocs = useMemo(
    () => documents.filter((d) => d.source === 'web'),
    [documents],
  );
  const webGroups = useMemo(
    () => groupsData.filter((g) => g.source === 'web'),
    [groupsData],
  );

  /** 「临时网页」= 打开的 raw 标签页且域名不在名单内（不落盘，只活在标签里）。 */
  /** 打开的文档集合（按 id 去重）——由 useOpenTabsPresentation 提供。 */

  const groups = useMemo<SidebarGroup[]>(() => {
    const list: SidebarGroup[] = [
      {
        key: 'docs',
        title: '本地文档',
        icon: FolderOpen,
        bg: 'bg-amber-500 text-amber-50 dark:bg-amber-600 dark:text-amber-100',
        docs: localDocs,
        target: 'docs',
      },
    ];
    for (const g of webGroups) {
      const docs = webDocs.filter((d) => d.group?.id === g.id);
      const pages = docs.filter((d) => d.type === 'snapshot').length;
      list.push({
        key: `web:${g.id}`,
        title: g.title || g.id,
        icon: Globe,
        iconUrl: g.icon,
        bg: 'bg-sky-500 text-sky-50 dark:bg-sky-600 dark:text-sky-100',
        docs,
        target: 'web',
        domain: g.id,
        countLabel: pages > 0 ? `${pages} 页` : '暂无',
      });
    }
    if (tempTabs.length > 0) {
      list.push({
        key: 'web:__temporary__',
        title: TEMP_PAGES_TITLE,
        icon: Hourglass,
        bg: 'bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100',
        docs: [],
        target: 'web',
        domain: TEMP_PAGES_DOMAIN,
        countLabel: `${tempTabs.length} 个标签`,
      });
    }
    return list;
  }, [localDocs, webGroups, webDocs, tempTabs]);

  // 顶置状态（纯 UI 偏好，内存态即可）
  const [pinned, setPinned] = useState<Record<string, boolean>>({
    docs: false,
  });
  const orderedGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) => (pinned[b.key] ? 1 : 0) - (pinned[a.key] ? 1 : 0),
      ),
    [groups, pinned],
  );

  /** 分组点击：web 域分组记录域后切二级列表；其余切二级形态。 */
  const handleGroupClick = (g: SidebarGroup): void => {
    if (g.target === 'web')
      setUiState({ sidebarView: 'web', sidebarDomain: g.domain ?? null });
    else setUiState({ sidebarView: g.target });
  };

  /** 展开项：被打开（全部）≠ 当前（唯一高亮）。 */
  const openContentFor = (g: SidebarGroup): React.ReactNode => {
    const openHere = openDocs.filter((d) => {
      if (g.target === 'web')
        return d.source === 'web' && d.group?.id === g.domain;
      return d.source === 'local' && d.type === 'content';
    });
    if (openHere.length === 0) return null;
    return openHere.map((d) => (
      <OpenItem
        key={d.id}
        testId="doc-open-item"
        icon={<FileText className="w-4 h-4" />}
        active={d.id === activeDocId}
        onClick={() => void useDocumentsStore.getState().open(d.id)}
        label={d.title}
        meta={d.sourceLabel}
      />
    ));
  };

  return (
    <div className="flex h-full w-full" data-testid="sidebar">
      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-[#1A1C1D] min-w-0">
        {/* 顶部视图切换（资源 / 插件 / 设置） */}
        <SidebarNav />
        {/* 列表主体（收起态由各行组件隐藏文字，间距/尺寸不变） */}
        <div className="flex-1 overflow-y-auto px-1 py-1 space-y-1">
          {view === 'main' &&
            orderedGroups.map((g) => {
              const count = g.docs.length;
              const countLabel =
                g.countLabel ?? (count > 0 ? `${count} 项` : '暂无');
              const latest =
                g.docs.length > 0
                  ? (g.docs[0].updatedAt ?? g.docs[0].createdAt)
                  : 0;

              return (
                <GroupRow
                  key={g.key}
                  title={g.title}
                  icon={g.icon}
                  iconUrl={g.iconUrl}
                  groupKey={g.key}
                  bg={g.bg}
                  count={count}
                  countLabel={countLabel}
                  latest={latest}
                  pinned={pinned[g.key]}
                  onTogglePin={() =>
                    setPinned((p) => ({ ...p, [g.key]: !p[g.key] }))
                  }
                  onClick={() => handleGroupClick(g)}
                  activeRow={openContentFor(g)}
                  collapsed={collapsed}
                />
              );
            })}

          {/* 二级列表（docs/data/web）与插件/设置形态；会话列表在设置域「会话管理」页 */}
          {view === 'find' && <FindList />}
          {view === 'plugins' && <PluginList />}
          {view === 'settings' && <SettingsList />}
          {view !== 'main' &&
            view !== 'plugins' &&
            view !== 'settings' &&
            view !== 'find' && (
            <DocumentList />
          )}
        </div>
      </div>
    </div>
  );
}
