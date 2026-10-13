/**
 * 工作区下拉选择器（TitleBar 左段）—— ui-design.md §三。
 *
 * 弹出面板 = 原生 Menu.popup（中栏扩展视图恒绘制于 DOM 之上——DOM 弹层必被遮挡）；
 * 按钮本体保留 DOM（工作区名 + 图标常态展示），仅弹出层走原生。
 * 页面开发阶段 popupMenu 由 bridge 回退为 DOM 等价物（同协议）。
 */
import { useEffect } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { agentAPI, electronAPI, popupMenu } from '../../api/bridge';
import { useAgentConfigStore } from '../../state/agentConfig';

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'workspace';

export function WorkspaceSelect() {
  const workspacePath = useAgentConfigStore((s) => s.status.workspacePath);
  const workspaceName = workspacePath
    ? (workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath)
    : '选择工作区';

  const pickWorkspace = async (): Promise<void> => {
    const dir = await agentAPI.pickWorkspace();
    if (dir) {
      // 专属切区通道（与模型配置解耦）：内部含资源域/技能刷新
      await useAgentConfigStore.getState().switchWorkspace(dir);
    }
  };

  const openMenu = (): void => {
    const path = workspacePath;
    const items: PopupMenuItem[] = [
      { id: 'current', label: path ?? '未设置工作目录', disabled: true },
    ];
    items.push({ id: 'pick', label: '选择目录…' });
    if (path) items.push({ id: 'reveal', label: '在系统文件管理器中打开' });
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
