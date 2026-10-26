/**
 * Shell 投影 store —— 主进程 shell 快照（layout）与视图集合（views）的渲染层唯一镜像。
 *
 * architecture.md §5.1.4：几何真相在主进程。DOM 区域（TitleBar / Sidebar / TabsBar / 空态）
 * 直接消费 layout 矩形（内联样式），不自行分栏、不丈量容器；无主进程桥时（独立页面开发）
 * 用同一个纯函数 computeLayout 本地计算——布局永远只有一份实现。
 */
import type { CSSProperties } from 'react';
import { create } from 'zustand';
import type { LayoutSnapshot, Rect, ViewEntry } from '../../shared/types';
import { computeLayout } from '../../shared/layout-engine';
import { useUiStore } from './uiState';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface ShellPresentation {
  /** 主进程布局快照（未水合前为 null）。 */
  layout: LayoutSnapshot | null;
  /** 视图集合投影（顺序 = 标签顺序；`active` 标出激活项）。 */
  views: ViewEntry[];
}

export const useShellStore = create<ShellPresentation>()(() => ({
  layout: null,
  views: [],
}));

/** 无桥（mock）时的本地布局：与主进程共用同一纯函数。 */
function localLayout(): LayoutSnapshot {
  return computeLayout({
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    ui: useUiStore.getState(),
    floating: null,
    preview: null,
  });
}

/** 启动投影：主进程桥存在时订阅 ws:state / ws:view，否则本地计算（resize / UI 变化重算）。 */
export async function initShellPresentation(): Promise<void> {
  if (mainBridge) {
    const result = await mainBridge.sync();
    useShellStore.setState({
      layout: result.shell.layout,
      views: result.views,
    });
    mainBridge.onState((snapshot) => {
      useShellStore.setState({ layout: snapshot.layout });
    });
    mainBridge.onViews((views) => useShellStore.setState({ views }));
    return;
  }
  const update = (): void => {
    useShellStore.setState({ layout: localLayout() });
  };
  update();
  window.addEventListener('resize', update);
  useUiStore.subscribe(update);
}

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
