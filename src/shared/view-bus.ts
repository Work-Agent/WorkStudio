/**
 * 视图总线类型化消息（views-design.md §九）。
 *
 * 经主进程 ws:bus 双向传递；主进程按 event.sender → viewId 路由。
 */

import type { DocumentContent, DocumentMeta } from './types';

// ─── 主进程 → 视图页 ──────────────────────────────────────

/** 内容投递（文档内容 + meta；非 ready 由 ViewHost 排队）。 */
export interface ViewContentMessage {
  type: 'content';
  payload: {
    /** 文本内容（data 轨为 schema 文本）。 */
    content: string;
    docId: string;
    ext: string;
    /** 资源三轨类型（content / data / snapshot）。 */
    type: DocumentContent['type'];
    meta: DocumentMeta;
  };
}

/** 主题广播（ready 时补发）。 */
export interface ViewThemeMessage {
  type: 'theme';
  theme: 'light' | 'dark';
}

/** 声明式动作下发（如 html-editor 的 layout-switch）。 */
export interface ViewActionMessage {
  type: 'action';
  id: string;
  payload?: unknown;
}

/** 助手视图形态（停靠 / 浮动）。 */
export interface ViewModeMessage {
  type: 'mode';
  floating: boolean;
  visible: boolean;
}

export type ViewBusMessageToView =
  | ViewContentMessage
  | ViewThemeMessage
  | ViewActionMessage
  | ViewModeMessage;

// ─── 视图页 → 主进程 ──────────────────────────────────────

/** 扩展页就绪握手（data:loaded 的替代；收编进类型化总线）。 */
export interface ViewLoadedMessage {
  type: 'loaded';
}

/** 编辑器脏态。 */
export interface ViewDirtyMessage {
  type: 'dirty';
  dirty: boolean;
}

/** 声明式动作状态回报。 */
export interface ViewActionStateMessage {
  type: 'actionState';
  id: string;
  value: unknown;
}

/** 视图内导航（raw 网页 / 插件页内部链接）。 */
export interface ViewNavigateMessage {
  type: 'navigate';
  url: string;
}

/** 网页可交互元素点击回填（ref）。 */
export interface ViewRefClickMessage {
  type: 'refClick';
  ref: string;
}

/** 页面日志（诊断用）。 */
export interface ViewLogMessage {
  type: 'log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type ViewBusMessageFromView =
  | ViewLoadedMessage
  | ViewDirtyMessage
  | ViewActionStateMessage
  | ViewNavigateMessage
  | ViewRefClickMessage
  | ViewLogMessage;
