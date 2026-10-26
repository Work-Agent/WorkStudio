/**
 * 文档域 store（zustand）—— URA 资源的渲染层投影（architecture.md §2.3）。
 *
 * 数据面：主进程命令 `ura.collections`；打开 = `views.openResource`（页面会话由主进程持有）。
 * 失效：`ws:resources` 事件订阅（文件系统变化 / agent 写盘 / 每轮收敛）。
 * 无 workbench 桥时（独立页面开发）回退旧 mock 数据面。
 */
import { create } from 'zustand';
import type { DocumentMeta, UraGroupInfo } from '../../shared/types';
import type { CollectionView, TreeItem } from '../../shared/ura';
import { agentAPI } from '../api/bridge';
import { useTabServiceStore } from './tabService';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface DocumentsState {
  documents: DocumentMeta[];
  groups: UraGroupInfo[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  groupsOf: (source: string) => UraGroupInfo[];
  open: (docId: string, meta?: DocumentMeta) => Promise<void>;
}

function toDocument(
  ref: string,
  title: string,
  source: string,
  sourceLabel: string,
  group: { id: string; title: string; icon?: string },
): DocumentMeta {
  const dot = title.lastIndexOf('.');
  return {
    id: ref,
    title,
    path: ref,
    url: ref,
    ext: dot <= 0 ? '' : title.slice(dot + 1).toLowerCase(),
    type: 'content',
    source,
    sourceLabel,
    group: {
      id: group.id,
      title: group.title,
      ...(group.icon ? { icon: group.icon } : {}),
    },
    createdAt: 0,
  };
}

export const useDocumentsStore = create<DocumentsState>()((set, get) => ({
  documents: [],
  groups: [],

  init: async () => {
    void get().refresh();
    if (mainBridge) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      mainBridge.onUra(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void get().refresh(), 150);
      });
      return;
    }
    agentAPI.documents.onRefresh(() => {
      void get().refresh();
    });
  },

  refresh: async () => {
    try {
      if (mainBridge) {
        const result = await mainBridge.cmd<CollectionView[]>('ura.collections');
        const documents: DocumentMeta[] = [];
        const groups: UraGroupInfo[] = [];
        for (const view of result.ok ? result.data : []) {
          const source = view.source === 'docs' ? 'local' : view.source;
          for (const group of view.groups) {
            groups.push({
              id: group.id,
              title: group.title,
              ...(group.icon ? { icon: group.icon } : {}),
              source,
              sourceLabel: view.label,
              count: group.items.length,
              updatedAt: 0,
            });
            for (const item of group.items) {
              documents.push(
                toDocument(item.ref, item.title, source, view.label, group),
              );
            }
          }
        }
        set({ documents, groups });
        return;
      }
      const [docs, groupList] = await Promise.all([
        agentAPI.documents.list(),
        agentAPI.documents.groups(),
      ]);
      set({ documents: docs, groups: groupList });
    } catch (e) {
      console.error('Failed to load documents:', e);
    }
  },

  /** 某 source 的分组（域分组行 / 行图标用；无分组 source 返回空数组）。 */
  groupsOf: (source) => get().groups.filter((g) => g.source === source),

  /** 打开文档：主进程 ViewHost 解析渲染器并投递内容；mock 路径走旧 tabService。 */
  open: async (docId, meta) => {
    if (mainBridge) {
      const doc = meta ?? get().documents.find((item) => item.id === docId);
      await mainBridge.cmd('views.openResource', {
        ref: docId,
        ...(doc ? { document: doc } : {}),
      });
      return;
    }
    const result = await agentAPI.documents.open(docId);
    if (!result) return;
    await useTabServiceStore
      .getState()
      .openDocument(result.meta, result.content);
  },
}));
