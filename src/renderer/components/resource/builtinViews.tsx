/**
 * 内置 DOM 视图注册表（extensionId → 组件）—— tabs-design.md §2.3 builtin。
 * 这类视图不占用原生 WebContentsView，由渲染层直接承载（ResourcePane 按 kind/注册表分流）。
 */
import type { ComponentType } from 'react';
import { SessionManagerView } from '../session/SessionManagerView';

export const BUILTIN_VIEWS: Record<string, ComponentType> = {
  'session-manager': SessionManagerView,
};
