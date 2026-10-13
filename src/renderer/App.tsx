/**
 * App —— 根组件：壳层装配（ui-design.md §1.1/§1.2）。
 *
 * 单一工作台页面：S1 TitleBar（常驻）+ 三栏（S2 Sidebar / S3 资源面板 / S4 AI 助手）。
 *   - 统一中栏架构：TitleBar 的插件入口只切换 Sidebar 列表形态（sidebarView）
 *   - 图标按钮打开态 = 图标本身靛蓝高亮（非背景块）
 */
import { useEffect } from 'react';
import { AssistantPanel } from './components/assistant/AssistantPanel';
import { FloatingAssistant } from './components/assistant/FloatingAssistant';
import { ResourcePane } from './components/resource/ResourcePane';
import { Sidebar } from './components/sidebar/Sidebar';
import { SplitView } from './components/SplitView';
import { TitleBar } from './components/titlebar/TitleBar';
import { setUiState, useUiStore } from './state/uiState';

export function App() {
  const theme = useUiStore((s) => s.theme);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const aiFloating = useUiStore((s) => s.aiFloating);
  const sidebarView = useUiStore((s) => s.sidebarView);

  // 主题 → html.dark class（驱动 Tailwind dark: 变体与 CSS 变量）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // TitleBar 插件入口：toggle Sidebar plugins 形态（配置即插件——设置在插件列表里打开）
  const openPlugins = (): void => {
    setUiState({ sidebarView: sidebarView === 'plugins' ? 'main' : 'plugins' });
  };
  const openSettings = (): void => {
    setUiState({
      sidebarView: sidebarView === 'settings' ? 'main' : 'settings',
    });
  };

  return (
    <div className="h-screen w-full flex flex-col bg-zinc-200 dark:bg-[#0a0a0a] text-zinc-900 dark:text-zinc-100 font-sans overflow-hidden">
      <TitleBar onOpenPlugins={openPlugins} onOpenSettings={openSettings} />
      <div className="flex flex-1 min-h-0 bg-zinc-200 dark:bg-[#0a0a0a] relative">
        <SplitView
          left={<Sidebar />}
          middle={<ResourcePane />}
          right={<AssistantPanel />}
          leftCollapsed={sidebarCollapsed}
          showRight={aiOpen && !aiFloating}
        />
      </div>
      {/* AI 面板浮动形态（独立浮动框；停靠态由 SplitView 右栏承载） */}
      {aiOpen && aiFloating && <FloatingAssistant />}
    </div>
  );
}
