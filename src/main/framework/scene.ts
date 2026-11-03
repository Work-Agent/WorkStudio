/**
 * App 原生现场（NativeScene）：只放影响原生窗口 / WebContentsView 的字段。
 *
 * 渲染层内部 UI（侧栏选中项、输入区、技能选择、标签顺序等）不在 App 持有；
 * 由渲染层自己的 store 管理。布局由原生现场 + 窗口 + 预览计算，不落盘。
 */

import type { UiState } from '../../shared/types';

export interface NativeScene {
  sidebarCollapsed: boolean;
  aiOpen: boolean;
  aiFloating: boolean;
  paneWidths: { left: number; right: number };
  floating: { x: number; y: number; width: number; height: number } | null;
}

export type NativeScenePatch = Partial<Omit<NativeScene, 'paneWidths'>> & {
  paneWidths?: Partial<NativeScene['paneWidths']>;
};

export const DEFAULT_NATIVE_SCENE: NativeScene = {
  sidebarCollapsed: false,
  aiOpen: true,
  aiFloating: false,
  paneWidths: { left: 240, right: 420 },
  floating: null,
};

export function patchNativeScene(
  scene: NativeScene,
  patch: NativeScenePatch,
): NativeScene {
  return {
    ...scene,
    ...patch,
    paneWidths: { ...scene.paneWidths, ...patch.paneWidths },
  };
}

/** 布局引擎仍吃完整 UiState；渲染层字段在这里只提供布局默认值。 */
export function toUiState(
  scene: NativeScene,
  theme: UiState['theme'],
): UiState {
  return {
    __version__: 2,
    theme,
    sidebarView: 'main',
    sidebarDomain: null,
    sidebarCollapsed: scene.sidebarCollapsed,
    sidebarGroup: null,
    panelCollapsed: false,
    inputExpanded: false,
    aiOpen: scene.aiOpen,
    aiFloating: scene.aiFloating,
    paneWidths: scene.paneWidths,
    selectedSkills: [],
    openPaths: [],
    activePath: null,
    openTabs: { order: [], pinned: [], activeKey: null },
  };
}
