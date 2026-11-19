/**
 * 壳层几何同步：把主进程 layout 写成 CSS 变量。
 *
 * 只有 layout 变化时重渲染；DOM 不参与测量。
 */
import { useLayoutEffect } from 'react';
import { SPLITTER_GAP } from '../../../../shared/layout.ts';
import type { LayoutSnapshot } from '../../../../shared/types.ts';
import { useLayout } from '../domains/layout.ts';

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
  const layout = useLayout();
  useLayoutEffect(() => applyGeometry(layout), [layout]);
  return null;
}
