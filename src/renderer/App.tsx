/**
 * App —— 根组件：壳层装配（architecture.md §2.1）。
 *
 * 单轨布局：所有区域（TitleBar / Sidebar / 资源面板 / 分隔条）都按主进程 `shell.layout`
 * 的矩形绝对定位——DOM 不分栏、不丈量；资源内容与 AI 助手是主进程的原生视图，DOM 不重复渲染。
 * 主题 → html.dark；页面视口上报（docked DevTools 让位）。
 */
import { useEffect } from 'react';
import { PaneSplitter } from './components/PaneSplitter';
import { ShellLayout } from './components/ShellLayout';
import { ResourcePane } from './components/resource/ResourcePane';
import { Sidebar } from './components/sidebar/Sidebar';
import { ToastHost } from './components/ToastHost';
import { TitleBar } from './components/titlebar/TitleBar';
import { useUiStore } from './state/ui';
import { cmd } from './api/appCommands';

export function App() {
  const theme = useUiStore((s) => s.theme);

  // 主题 → html.dark class（驱动 Tailwind dark: 变体与 CSS 变量）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 页面视口上报：docked DevTools 会把页面变小，主进程据此收缩原生视图（浏览器语义）。
  useEffect(() => {
    const report = (): void => {
      void cmd('debug.viewport', {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, []);

  // TitleBar 插件 / 设置入口已移入 Sidebar 顶部导航（SidebarNav）
  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-100 dark:bg-[#1a1c1d] text-zinc-900 dark:text-zinc-100 font-sans">
      {/* 壳层几何由 CSS 变量驱动（ShellLayout 同步）；React 不因拖拽重渲染。 */}
      <div className="shell-titlebar">
        <TitleBar />
      </div>
      <div className="shell-sidebar">
        <Sidebar />
      </div>
      <PaneSplitter />
      <ResourcePane />
      <ShellLayout />
      <ToastHost />
    </div>
  );
}
