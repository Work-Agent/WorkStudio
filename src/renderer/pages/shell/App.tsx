/**
 * App —— 根组件：壳层装配（architecture.md §2.1）。
 *
 * 单轨布局：所有区域（TitleBar / Sidebar / 资源面板 / 分隔条）都按主进程 `layout`
 * 的矩形绝对定位——DOM 不分栏、不丈量；资源内容与 AI 助手是主进程的原生视图。
 */
import { PaneSplitter } from './components/PaneSplitter.tsx';
import { ShellLayout } from './components/ShellLayout.tsx';
import { ResourcePane } from './components/resource/ResourcePane.tsx';
import { Sidebar } from './components/sidebar/Sidebar.tsx';
import { ToastHost } from '../../shared/domains/toast-host.tsx';
import { TitleBar } from './components/titlebar/TitleBar.tsx';

export function App() {
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
