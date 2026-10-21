/**
 * 打开标签投影（Sidebar 展开项 / 二级列表 / 临时网页共用）。
 *
 * 新架构：集合真相在主进程 ViewHost，渲染层消费 `shell.views`（ws:view 快照）；
 * 旧 mock 路径（独立页面开发）继续消费 tabs store。
 */
import type { DocumentMeta, ViewEntry } from '../../shared/types';
import { useShellStore } from './shell';
import {
  activeDocIdOf,
  openDocsOf,
  tempTabsOf,
  useTabsStore,
  type TabEntry,
} from './tabs';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

export interface TempTabProjection {
  instanceId: string;
  title: string;
  url: string;
}

export interface OpenTabsProjection {
  openDocs: DocumentMeta[];
  tempTabs: TempTabProjection[];
  activeDocId: string | null;
  activeInstanceId: string | null;
}

/** 从 ViewHost 集合投影（顺序 = 标签顺序；document 去重）。 */
function fromViews(views: ViewEntry[]): OpenTabsProjection {
  const seen = new Map<string, DocumentMeta>();
  const tempTabs: TempTabProjection[] = [];
  for (const v of views) {
    if (v.document) seen.set(v.document.id, v.document);
    if (v.type === 'browser' && v.temporary) {
      tempTabs.push({ instanceId: v.id, title: v.title, url: v.url });
    }
  }
  const active = views.find((v) => v.active) ?? null;
  return {
    openDocs: [...seen.values()],
    tempTabs,
    activeDocId: active?.document?.id ?? null,
    activeInstanceId: active?.id ?? null,
  };
}

function fromTabs(
  tabs: TabEntry[],
  activeId: string | null,
): OpenTabsProjection {
  return {
    openDocs: openDocsOf(tabs),
    tempTabs: tempTabsOf(tabs).map((t) => ({
      instanceId: t.instanceId,
      title: t.title,
      url: t.url,
    })),
    activeDocId: activeDocIdOf(tabs, activeId),
    activeInstanceId: activeId,
  };
}

export function useOpenTabsProjection(): OpenTabsProjection {
  const views = useShellStore((s) => s.views);
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  return mainBridge ? fromViews(views) : fromTabs(tabs, activeId);
}
