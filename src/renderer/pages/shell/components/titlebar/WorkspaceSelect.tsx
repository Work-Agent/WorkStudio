/**
 * 工作区选择器（TitleBar 左区 ①）—— architecture.md §2.2。
 *
 * 弹出面板 = 原生 Menu.popup（中栏扩展视图恒绘制于 DOM 之上——DOM 弹层必被遮挡）；
 * 按钮本体保留 DOM（工作区名 + 图标常态展示），仅弹出层走原生。
 * 工作区清单来自主进程 `agent.workspaces`（ws/<wsId>/workspace.json 投影）。
 */
import { useEffect } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import type { PopupMenuItem } from '../../../../../shared/types.ts';
import { command } from '../../../../shared/api/bridge.ts';
import { electronAPI, popupMenu } from '../../../../shared/api/runtime.ts';
import { useWorkspaces } from '../../../../shared/domains/workspaces.ts';

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'workspace';

export function WorkspaceSelect() {
  const { list, current, open } = useWorkspaces();
  const workspacePath = current?.path ?? '';
  const workspaceName = workspacePath
    ? (workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath)
    : '选择工作区';

  const pickWorkspace = async (): Promise<void> => {
    const dir = await command<string | null>(
      'shell',
      'native',
      'pickDirectory',
      {},
    );
    if (dir) await open(dir);
  };

  const openMenu = (): void => {
    const items: PopupMenuItem[] = [];
    const currentPath = workspacePath;
    for (const ws of list.slice(0, 8)) {
      items.push({
        id: `ws:${ws.path}`,
        label: `${ws.id === current?.id ? '✓ ' : ''}${ws.name}`,
        disabled: ws.id === current?.id,
      });
    }
    if (items.length === 0) {
      items.push({ id: 'current', label: '尚未注册工作区', disabled: true });
    }
    items.push({ id: 'pick', label: '选择目录…' });
    if (currentPath) {
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
        if (workspacePath) void electronAPI.openPath(workspacePath);
      } else if (e.actionId === 'manage') {
        void command('settings', 'pages', 'open', { pageId: 'workspaces' });
      } else if (e.actionId.startsWith('ws:')) {
        void open(e.actionId.slice(3));
      }
    });
  }, [open]);

  return (
    <button
      data-testid="workspace-select"
      onClick={openMenu}
      className="flex items-center gap-1.5 min-w-0 max-w-full rounded-md px-1.5 py-0.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-[#2f3233] transition-colors"
      title={workspaceName}
    >
      <FolderOpen className="w-3 h-3 shrink-0 text-[#4F6BED]" />
      <span className="text-[12px] truncate">{workspaceName}</span>
      <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
    </button>
  );
}
