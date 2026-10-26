/**
 * S1 应用壳层 TitleBar —— architecture.md §13.1。
 *
 *   - 左区：① 工作区选择器 + ② 侧栏开关（同一布局分组，次序可互换）
 *   - 中区：资源地址栏（浏览器地址栏语义：url + spinner + 按类型动作）
 *   - 右区：AI / 主题 / W 徽标（资源 / 插件 / 设置切换在 Sidebar 顶部导航，见 SidebarNav）
 */
import {
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
} from 'lucide-react';
import { setUiState, toggleTheme, useUiStore } from '../../state/uiState';
import { ResourceToolbar } from './ResourceToolbar';
import { WorkspaceSelect } from './WorkspaceSelect';

export function TitleBar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const aiOpen = useUiStore((s) => s.aiOpen);
  const theme = useUiStore((s) => s.theme);

  const iconButton = (active: boolean): string =>
    `h-8 w-8 rounded-md flex items-center justify-center transition-colors ${
      active
        ? 'text-[#4F6BED] dark:text-[#6c86f0] hover:bg-zinc-200 dark:hover:bg-[#2f3233]'
        : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100'
    }`;

  return (
    <div className="titlebar shrink-0 flex items-center gap-1.5 border-b border-l border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#1A1C1D] select-none">
      {/* ── 左区：① 工作区选择器 + ② 侧栏开关（弹出层 = 原生菜单） ── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <WorkspaceSelect />
        <button
          onClick={() => setUiState({ sidebarCollapsed: !sidebarCollapsed })}
          data-testid="sidebar-toggle"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className="h-8 w-8 rounded-md flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 拖拽区 + 中央地址栏 */}
      <div className="flex-1 min-w-0 flex justify-center px-2">
        <ResourceToolbar />
      </div>

      {/* ── 右区 · ④ 动作组：AI / 主题 / W 徽标（图标本色高亮制） ── */}
      <div className="flex items-center">
        <button
          onClick={() => setUiState({ aiOpen: !aiOpen })}
          title={aiOpen ? '收起 AI 对话' : '展开 AI 对话'}
          className={iconButton(aiOpen)}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换为亮色' : '切换为暗色'}
          className="h-8 w-8 rounded-md flex items-center justify-center transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
        <div
          title="Work Studio"
          className="ml-1 h-7 w-7 rounded-full flex items-center justify-center bg-[#4F6BED] text-white text-[12px] font-semibold"
        >
          W
        </div>
      </div>
    </div>
  );
}
