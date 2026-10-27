/**
 * 工作区作用域 store —— layout / views / lists 的渲染层投影。
 *
 * 主进程是工作区现场的唯一真相源；渲染层只消费 AppSnapshot.workspace。
 * 布局矩形由主进程计算，DOM 各区域直接消费矩形，不自行分栏或丈量。
 */
import type { CSSProperties } from 'react';
import { create } from 'zustand';
import type { ListGroup } from '../../shared/lists';
import type { LayoutSnapshot, Rect, ViewEntry } from '../../shared/types';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface WorkspaceState {
  /** 主进程布局快照（未水合前为 null）。 */
  layout: LayoutSnapshot | null;
  /** 视图集合投影（顺序 = 标签顺序；`active` 标出激活项）。 */
  views: ViewEntry[];
  /** 当前工作区列表快照。 */
  groups: ListGroup[];
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  layout: null,
  views: [],
  groups: [],
}));

/** 视图命令唯一出口（失败静默：主进程广播会把事实收敛回来）。 */
export function runViewCommand(command: string, params?: unknown): void {
  void mainBridge?.cmd(command, params);
}

/** 布局矩形 → 内联绝对定位样式（DOM 各区域与原生视图共用同一份矩形）。 */
export function rectStyle(rect: Rect): CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}
