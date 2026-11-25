/**
 * 窗口布局：DOM 条带与原生视图共用的默认几何。
 *
 * 渲染层后续可通过 shell/<wsId>/layout 提交持久快照；没有快照时按默认三栏几何，
 * 至少保证 titlebar / sidebar / tabbar 不被内容视图覆盖。
 */

import { computeLayout } from '../../../shared/layout-engine.ts';
import type { LayoutSnapshot, UiState } from '../../../shared/types.ts';

export const DEFAULT_UI: UiState = {
  __version__: 1,
  theme: 'dark',
  aiOpen: true,
  aiFloating: false,
  sidebarView: 'main',
  sidebarDomain: null,
  sidebarCollapsed: false,
  sidebarGroup: null,
  panelCollapsed: false,
  inputExpanded: false,
  selectedSkills: [],
  paneWidths: { left: 240, right: 420 },
  activePath: null,
  openPaths: [],
};

export function defaultLayout(
  windowWidth: number,
  windowHeight: number,
  ui: UiState = DEFAULT_UI,
): LayoutSnapshot {
  return computeLayout({
    windowWidth,
    windowHeight,
    ui,
    floating: null,
    preview: null,
  });
}
