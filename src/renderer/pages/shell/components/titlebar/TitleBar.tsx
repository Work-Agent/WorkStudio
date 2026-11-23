/**
 * S1 应用壳层 TitleBar —— architecture.md §2.2。
 *
 *   - 左区：① 工作区选择器 + ② 侧栏开关（同一布局分组，次序可互换）
 *   - 中区：资源地址栏（浏览器地址栏语义：url + spinner + 按类型动作）
 *   - 右区：设置 / AI / 主题 / W 徽标（资源 / 插件切换在 Sidebar 顶部导航）
 */
import {
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Sun,
  UserRoundKey,
} from 'lucide-react';
import { command } from '../../../../shared/api/bridge.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useScene } from '../../domains/scene.ts';
import { useTheme } from '../../domains/theme.ts';
import { ResourceToolbar } from './ResourceToolbar.tsx';
import { WorkspaceSelect } from './WorkspaceSelect.tsx';

export function TitleBar() {
  const { scene, patch } = useScene();
  const sidebarCollapsed = scene.sidebarCollapsed ?? false;
  const aiOpen = scene.aiOpen ?? true;
  const { theme, toggle } = useTheme();

  const iconButton = (active: boolean): string =>
    `h-8 w-8 rounded-md flex items-center justify-center transition-colors ${
      active
        ? 'text-[#4F6BED] dark:text-[#6c86f0] hover:bg-zinc-200 dark:hover:bg-[#2f3233]'
        : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100'
    }`;

  const openSettings = async (): Promise<void> => {
    try {
      await command('settings', 'pages', 'open', { pageId: 'appearance' });
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : String(error),
        'settings',
      );
    }
  };

  const openWelcome = async (): Promise<void> => {
    try {
      await command('settings', 'pages', 'open', { pageId: 'welcome' });
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : String(error),
        'welcome',
      );
    }
  };

  return (
    <div className="titlebar shrink-0 flex items-center gap-1.5 border-b border-l border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-[#1A1C1D] select-none">
      {/* ── 左区：① 工作区选择器 + ② 侧栏开关（弹出层 = 原生菜单） ── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <WorkspaceSelect />
        <button
          onClick={() => patch({ sidebarCollapsed: !sidebarCollapsed })}
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

      {/* ── 右区 · ④ 动作组：设置 / AI / 主题 / W 徽标 ── */}
      <div className="flex items-center">
        <button
          onClick={() => void openSettings()}
          data-testid="titlebar-settings"
          title="设置"
          className={iconButton(false)}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => patch({ aiOpen: !aiOpen })}
          title={aiOpen ? '收起 AI 对话' : '展开 AI 对话'}
          className={iconButton(aiOpen)}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          onClick={toggle}
          title={theme === 'dark' ? '切换为亮色' : '切换为暗色'}
          className="h-8 w-8 rounded-md flex items-center justify-center transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => void openWelcome()}
          data-testid="titlebar-welcome"
          title="Work Studio · 工作台首页"
          className="ml-1 h-7 w-7 rounded-full flex items-center justify-center bg-[#4F6BED] text-white text-[12px] font-semibold hover:bg-[#3D56E0] transition-colors"
        >
          <UserRoundKey className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
