/**
 * DocumentList —— 文档二级列表（architecture.md §2.3）。
 *
 * 形态（按 sidebarView）：
 *   docs  → 本地文档
 *   data  → 业务数据
 *   web   → 选中域（sidebarDomain）的 L3 页面快照
 * 行点击 = openDocument（按 ext 匹配扩展视图，兜底 text-editor）。
 */
import { useMemo } from 'react';
import {
  ArrowRight,
  Database,
  FileText,
  FolderOpen,
  Globe,
  Hourglass,
  Map as MapIcon,
} from 'lucide-react';
import type { DocumentMeta } from '../../../shared/types';
import { useDocumentsStore } from '../../state/documents';
import { useOpenTabsPresentation } from '../../state/openTabs';
import { useTabServiceStore } from '../../state/tabService';
import { useUiStore } from '../../state/uiState';
import { EmptyState, SubListView } from './SubListView';
import { TEMP_PAGES_DOMAIN, TEMP_PAGES_TITLE } from './tempPages';
import { formatTime } from './time';

function DocumentRow({
  doc,
  active,
  iconUrl,
}: {
  doc: DocumentMeta;
  active?: boolean;
  iconUrl?: string;
}) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const isData = doc.type === 'data';
  const isWeb = doc.source === 'web';
  const isGuide = isWeb && doc.type === 'content';
  return (
    <div
      onClick={() => void useDocumentsStore.getState().open(doc.id)}
      className="group relative flex items-center px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#2a2c2d] transition-colors min-h-[42px]"
      title={doc.id}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
      )}
      <div
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
          isData
            ? 'bg-teal-100 dark:bg-[#1a2a25]'
            : isWeb
              ? 'bg-sky-100 dark:bg-[#1a2430]'
              : 'bg-zinc-200 dark:bg-[#32363a]'
        }`}
      >
        {isData ? (
          <Database className="w-4 h-4 text-teal-600 dark:text-teal-500" />
        ) : isGuide ? (
          <MapIcon className="w-4 h-4 text-sky-600 dark:text-sky-500" />
        ) : isWeb && iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-contain p-1"
          />
        ) : isWeb ? (
          <Globe className="w-4 h-4 text-sky-600 dark:text-sky-500" />
        ) : (
          <FileText className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
        )}
      </div>
      <div className="ml-2 flex-1 overflow-hidden min-w-0">
        {!collapsed && (
          <>
            <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
              {doc.title}
            </h4>
            <div className="flex items-center justify-between mt-[5px]">
              <span className="text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                {isData
                  ? 'schema-only · 数据经工具查询'
                  : (doc.description ?? doc.sourceLabel)}
              </span>
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 ml-1.5">
                {formatTime(doc.updatedAt ?? doc.createdAt)}
              </span>
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <ArrowRight className="absolute right-1.5 top-1.5 w-3 h-3 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );
}

export function DocumentList() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const view = useUiStore((s) => s.sidebarView);
  const sidebarDomain = useUiStore((s) => s.sidebarDomain);
  const documents = useDocumentsStore((s) => s.documents);
  const groups = useDocumentsStore((s) => s.groups);
  const { tempTabs, activeDocId, activeInstanceId } = useOpenTabsPresentation();

  const webGroups = groups.filter((g) => g.source === 'web');
  const activeWebGroup =
    webGroups.find((g) => g.id === sidebarDomain) ?? webGroups[0];

  /** 临时网页形态：二级列表 = 打开的（名单外）标签页，而不是 URA 文档。 */
  const isTempPages = view === 'web' && sidebarDomain === TEMP_PAGES_DOMAIN;

  /** 当前形态的数据源（标题 / 空态图标 / 文档集）。 */
  const form = useMemo(() => {
    if (view === 'docs') {
      return {
        title: '本地文档',
        icon: FolderOpen,
        docs: documents.filter(
          (d) => d.source === 'local' && d.type === 'content',
        ),
      };
    }
    if (view === 'data') {
      return {
        title: '业务数据',
        icon: Database,
        docs: documents.filter((d) => d.type === 'data'),
      };
    }
    if (isTempPages) {
      return {
        title: TEMP_PAGES_TITLE,
        icon: Hourglass,
        docs: [] as DocumentMeta[],
      };
    }
    if (view === 'web') {
      // 只列该域 L3 页面快照：L2 导览的唯一展示地 = 浏览器插件设置页
      const grp = activeWebGroup;
      return {
        title: grp
          ? `${grp.title}${grp.title === grp.id ? '' : `（${grp.id}）`}`
          : '网站资料',
        icon: Globe,
        docs: grp
          ? documents.filter(
              (d) =>
                d.source === 'web' &&
                d.type === 'snapshot' &&
                d.group?.id === grp.id,
            )
          : [],
      };
    }
    return { title: '', icon: FileText, docs: [] as DocumentMeta[] };
  }, [view, isTempPages, activeWebGroup, documents]);

  /** 域图标映射（行图标）：source::groupId → favicon data-url。 */
  const iconMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const grp of groups) {
      if (grp.icon) map.set(`${grp.source}::${grp.id}`, grp.icon);
    }
    return map;
  }, [groups]);

  const iconFor = (d: DocumentMeta): string | undefined =>
    d.group ? iconMap.get(`${d.source}::${d.group.id}`) : undefined;

  // 排序：快照按时间倒序（L2 导览不在本列表）
  const docs = useMemo(
    () =>
      [...form.docs].sort(
        (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
      ),
    [form.docs],
  );
  const FormIcon = form.icon;

  if (isTempPages) {
    // 临时网页：行 = 打开的标签页（点击切到该标签），不涉及资源/文档
    return (
      <SubListView title={TEMP_PAGES_TITLE} count={tempTabs.length}>
        {tempTabs.length > 0 ? (
          tempTabs.map((tab) => {
            let host = tab.url;
            try {
              host = new URL(tab.url).host;
            } catch {
              /* keep url */
            }
            return (
              <div
                key={tab.instanceId}
                data-testid="temp-page-tab"
                onClick={() => {
                  const bridge = window.workbench;
                  if (bridge)
                    void bridge.cmd('views.activate', {
                      id: tab.instanceId,
                    });
                  else
                    void useTabServiceStore
                      .getState()
                      .activateInstance(tab.instanceId);
                }}
                className="group relative flex items-center px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-200 dark:hover:bg-[#2a2c2d] transition-colors min-h-[42px]"
                title={tab.url}
              >
                {tab.instanceId === activeInstanceId && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4F6BED] rounded-r" />
                )}
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-[#32363a]">
                  <Globe className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                </div>
                <div className="ml-2 flex-1 overflow-hidden min-w-0">
                  {!collapsed && (
                    <>
                      <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
                        {tab.title}
                      </h4>
                      <div className="flex items-center justify-between mt-[5px]">
                        <span className="text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                          {host}
                        </span>
                        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0 ml-1.5">
                          临时
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState
            icon={Hourglass}
            text="暂无临时网页（打开未收录站点的标签页即出现）"
          />
        )}
      </SubListView>
    );
  }

  return (
    <SubListView title={form.title} count={docs.length}>
      {docs.length === 0 ? (
        <EmptyState icon={FormIcon} text={`暂无${form.title || ''}`} />
      ) : (
        docs.map((d) => (
          <DocumentRow
            key={d.id}
            doc={d}
            active={d.id === activeDocId}
            iconUrl={iconFor(d)}
          />
        ))
      )}
    </SubListView>
  );
}
