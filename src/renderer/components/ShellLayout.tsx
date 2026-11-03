/**
 * 壳层几何同步：把主进程 layout 写成 CSS 变量。
 *
 * 拖拽 / 窗口缩放时只有 layout 状态更新，不被业务快照重建打断；
 * App、Sidebar、列表、标签栏都不因几何变化重渲染。
 */
import { useLayoutEffect } from 'react';
import { SPLITTER_GAP } from '../../shared/layout';
import type { LayoutSnapshot } from '../../shared/types';
import { useWorkspaceStore } from '../state/workspace';

function applyGeometry(layout: LayoutSnapshot | null): void {
  if (!layout) return;
  const style = document.documentElement.style;
  style.setProperty('--wb-titlebar-h', `${layout.titlebar.height}px`);
  style.setProperty('--wb-workbench-y', `${layout.workbench.y}px`);
  style.setProperty('--wb-workbench-h', `${layout.workbench.height}px`);
  style.setProperty('--wb-sidebar-w', `${layout.sidebar.width}px`);
  style.setProperty('--wb-resource-x', `${layout.resourcePane.x}px`);
  style.setProperty('--wb-resource-w', `${layout.resourcePane.width}px`);
  style.setProperty('--wb-tabbar-h', `${layout.tabbar.height}px`);
  style.setProperty('--wb-content-y', `${layout.resourceContent.y}px`);
  style.setProperty('--wb-content-h', `${layout.resourceContent.height}px`);
  style.setProperty('--wb-splitter-w', `${SPLITTER_GAP}px`);
}

export function ShellLayout() {
  useLayoutEffect(() => {
    applyGeometry(useWorkspaceStore.getState().layout);
    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      if (state.layout !== prev.layout) applyGeometry(state.layout);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  return null;
}
