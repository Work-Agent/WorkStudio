/**
 * 文档域 store（zustand）—— URA 资源的渲染层投影（ui-design.md §二 Document / §4.1）。
 *
 * 拉取：IPC 命令；失效：documents.onRefresh 事件订阅（文件系统变化 / agent 写盘）。
 * 打开 = 读内容（content 全文 / data schema）→ 委托资源面板域路由到扩展视图。
 */
import { create } from 'zustand';
import type { DocumentMeta, UraGroupInfo } from '../../shared/types';
import { agentAPI } from '../api/bridge';
import { useTabServiceStore } from './tabService';

interface DocumentsState {
  documents: DocumentMeta[];
  groups: UraGroupInfo[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  groupsOf: (source: string) => UraGroupInfo[];
  open: (docId: string) => Promise<void>;
}

export const useDocumentsStore = create<DocumentsState>()((set, get) => ({
  documents: [],
  groups: [],

  init: async () => {
    void get().refresh();
    agentAPI.documents.onRefresh(() => {
      void get().refresh();
    });
  },

  refresh: async () => {
    try {
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

  /** 打开文档：读内容（content 全文 / data schema）→ 路由到扩展视图。 */
  open: async (docId) => {
    const result = await agentAPI.documents.open(docId);
    if (!result) return;
    await useTabServiceStore
      .getState()
      .openDocument(result.meta, result.content);
  },
}));
