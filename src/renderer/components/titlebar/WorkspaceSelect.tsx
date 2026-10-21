/**
 * 工作区选择器（TitleBar 左区 ①）—— views-design.md §3.1。
 *
 * 弹出面板 = 原生 Menu.popup（中栏扩展视图恒绘制于 DOM 之上——DOM 弹层必被遮挡）；
 * 按钮本体保留 DOM（工作区名 + 图标常态展示），仅弹出层走原生。
 * 工作区清单来自主进程 `agent.workspaces`（ws/<wsId>/workspace.json 投影）。
 */
import { useEffect } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { electronAPI, popupMenu } from '../../api/bridge';
import { useAgentConfigStore } from '../../state/agentConfig';
import { runViewCommand } from '../../state/shell';

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'workspace';

export function WorkspaceSelect() {
  const workspacePath = useAgentConfigStore((s) => s.status.workspacePath);
  const workspaces = useAgentConfigStore((s) => s.workspaces);
  const workspaceName = workspacePath
    ? (workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath)
    : '选择工作区';

  const pickWorkspace = async (): Promise<void> => {
    const bridge = window.workbench;
    const dir = bridge
      ? await bridge
          .cmd<string | null>('agent.pickWorkspace')
          .then((r) => (r.ok ? r.data : null))
      : await window.agentAPI?.pickWorkspace().then((p) => p ?? null);
    if (dir) {
      await useAgentConfigStore.getState().switchWorkspace(dir);
    }
  };

  const openMenu = (): void => {
    void useAgentConfigStore.getState().refreshWorkspaces();
    const items: PopupMenuItem[] = [];
    const current = workspacePath;
    for (const ws of workspaces.slice(0, 8)) {
      items.push({
        id: `ws:${ws.path}`,
        label: `${ws.current ? '✓ ' : ''}${ws.name} — ${ws.path}`,
        disabled: ws.current,
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
        const path = useAgentConfigStore.getState().status.workspacePath;
        if (path) void electronAPI.openPath(path);
      } else if (e.actionId === 'manage') {
        runViewCommand('views.open', {
          input: { type: 'plugin', pluginId: 'settings-workspaces' },
        });
      } else if (e.actionId.startsWith('ws:')) {
        void useAgentConfigStore
          .getState()
          .switchWorkspace(e.actionId.slice(3));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      data-testid="workspace-select"
      onClick={openMenu}
      className="flex items-center gap-1.5 min-w-0 max-w-full rounded-md px-1.5 py-0.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-[#2f3233] transition-colors"
      title={workspacePath ?? '选择工作目录'}
    >
      <FolderOpen className="w-3 h-3 shrink-0 text-[#4F6BED]" />
      <span className="text-[12px] truncate">{workspaceName}</span>
      <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
    </button>
  );
}
