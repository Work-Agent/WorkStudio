/**
 * 工作区选择器（TitleBar 左区 ①）—— architecture.md §2.2。
 *
 * 弹出面板 = 原生 Menu.popup（中栏扩展视图恒绘制于 DOM 之上——DOM 弹层必被遮挡）；
 * 按钮本体保留 DOM（工作区名 + 图标常态展示），仅弹出层走原生。
 * 工作区清单来自主进程 `agent.workspaces`（ws/<wsId>/workspace.json 投影）。
 */
import { useEffect } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { cmd } from '../../api/appCommands';
import { electronAPI, popupMenu } from '../../api/runtime';
import { useAppStore } from '../../state/app';
import { runViewCommand } from '../../state/workspace';

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'workspace';

export function WorkspaceSelect() {
  const workspacePath = useAppStore((s) => s.status.workspacePath);
  const workspaces = useAppStore((s) => s.workspaces);
  const workspaceName =
    workspaces.find((ws) => ws.path === workspacePath)?.name ??
    (workspacePath
      ? (workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath)
      : '选择工作区');

  const pickWorkspace = async (): Promise<void> => {
    const dir = await cmd<string | null>('agent.pickWorkspace').then((r) =>
      r.ok ? r.data : null,
    );
    if (dir) {
      await useAppStore.getState().switchWorkspace(dir);
    }
  };

  const openMenu = (): void => {
    const items: PopupMenuItem[] = [];
    const current = workspacePath;
    for (const ws of workspaces) {
      items.push({
        id: `ws:${ws.path}`,
        label: `${ws.current ? '✓ ' : ''}${ws.name}`,
        disabled: ws.current || !ws.exists,
      });
    }
    if (items.length === 0) {
      items.push({ id: 'current', label: '尚未注册工作区', disabled: true });
    }
    items.push({ id: 'pick', label: '选择目录…' });
    if (current) {
      items.push({ id: 'reveal', label: '在系统文件管理器中打开' });
      items.push({ id: 'manage', label: '工作区管理…' });
    }
    void popupMenu.show({ source: MENU_SOURCE, items });
  };

  // 选中回执（source 路由）
  useEffect(() => {
    return popupMenu.onSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      if (e.actionId === 'pick') void pickWorkspace();
      else if (e.actionId === 'reveal') {
        const path = useAppStore.getState().status.workspacePath;
        if (path) void electronAPI.openPath(path);
      } else if (e.actionId === 'manage') {
        runViewCommand('views.open', {
          input: { type: 'settings', pageId: 'workspaces' },
        });
      } else if (e.actionId.startsWith('ws:')) {
        void useAppStore.getState().switchWorkspace(e.actionId.slice(3));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      data-testid="workspace-select"
      onClick={openMenu}
      className="flex items-center gap-1.5 min-w-0 max-w-full rounded-md px-1.5 py-0.5 text-[var(--biz-text-muted)] text-[var(--biz-text)] hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] transition-colors"
      title={workspaceName}
    >
      <FolderOpen className="w-3 h-3 shrink-0 text-[var(--biz-accent)]" />
      <span className="text-[12px] truncate">{workspaceName}</span>
      <ChevronDown className="w-3 h-3 shrink-0 text-[var(--biz-text-muted)]" />
    </button>
  );
}
