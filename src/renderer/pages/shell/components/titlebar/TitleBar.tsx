/**
 * S1 应用壳层 TitleBar —— architecture.md §2.2。
 *
 *   - 左区：① 工作区选择器 + ② 侧栏开关（同一布局分组，次序可互换）
 *   - 中区：资源地址栏（浏览器地址栏语义：url + spinner + 按类型动作）
 *   - 右区：设置 / AI / 主题 / 账号头像（未登录点击进登录页；资源 / 插件切换在 Sidebar 顶部导航）
 */
import {
  CircleUserRound,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
import { command, useResource } from '../../../../shared/api/bridge.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useScene } from '../../domains/scene.ts';
import { useTheme } from '../../domains/theme.ts';
import { ResourceToolbar } from './ResourceToolbar.tsx';
import { WorkspaceSelect } from './WorkspaceSelect.tsx';

interface ProviderView {
  id: string;
  configured: boolean;
  authLabel?: string;
}

/** 快捷登录的供应商；登录后 TitleBar 换成用户头像。 */
const ACCOUNT_PROVIDER = 'simbalink';

export function TitleBar() {
  const { scene, patch } = useScene();
  const providers = useResource<ProviderView[]>('agent', 'providers', []);
  const account = providers.find((item) => item.id === ACCOUNT_PROVIDER);
  const signedIn = account?.configured === true;
  const accountName = account?.authLabel ?? account?.id ?? '';
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

      {/* ── 右区 · ④ 动作组：设置 / AI / 主题 / 账号头像 ── */}
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
          data-testid="theme-toggle"
          title={
            theme === 'dark' ? '当前深色，切换为浅色' : '当前浅色，切换为深色'
          }
          className="h-8 w-8 rounded-md flex items-center justify-center transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2f3233] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {theme === 'dark' ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          data-testid="titlebar-user"
          data-signed-in={signedIn ? 'true' : 'false'}
          title={
            signedIn
              ? `已登录 ${accountName || ACCOUNT_PROVIDER}`
              : '登录 Simbalink'
          }
          onClick={() => {
            // 已登录：暂时不响应；未登录：直接打开供应商登录页。
            if (signedIn) return;
            void command('agent', 'providers', 'openLogin', {
              providerId: ACCOUNT_PROVIDER,
            }).catch((error: unknown) =>
              notifyError(
                error instanceof Error ? error.message : String(error),
                'account',
              ),
            );
          }}
          className={
            signedIn
              ? 'ml-1 h-7 w-7 rounded-full flex items-center justify-center bg-[#4F6BED] text-white text-[12px] font-semibold'
              : 'ml-1 h-7 w-7 rounded-full flex items-center justify-center text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-[#2f3233] dark:hover:text-zinc-200'
          }
        >
          {signedIn ? (
            <span>{accountName.slice(0, 1).toUpperCase() || 'S'}</span>
          ) : (
            <CircleUserRound className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>
    </div>
  );
}
