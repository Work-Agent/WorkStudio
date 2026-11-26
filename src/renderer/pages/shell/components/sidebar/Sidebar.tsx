/**
 * S2 左栏 Sidebar —— 资源森林 + 插件注册表。
 *
 * 文件列表与插件列表是两套独立资源：
 *   workspace/<wsId>/resources  → 资源森林
 *   plugin/registry             → 已安装 / 可安装插件
 * 设置入口仍在 TitleBar。
 */
import { useResourceForest } from '../../../../shared/domains/resources.ts';
import { useScene } from '../../domains/scene.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';
import { FindList } from './FindList.tsx';
import { PluginRegistryView } from './PluginRegistryView.tsx';
import { ResourceTree } from './ResourceTree.tsx';
import { SidebarNav } from './SidebarNav.tsx';

export function Sidebar() {
  const view = useSidebarStore((s) => s.view);
  const scene = useScene().scene;
  const collapsed = scene.sidebarCollapsed ?? false;
  const groups = useResourceForest();
  const visible = groups.filter((group) =>
    view === 'settings'
      ? group.section === 'settings'
      : group.section === 'resources',
  );

  return (
    <div className="flex h-full w-full" data-testid="sidebar">
      <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-[#1A1C1D] min-w-0">
        <SidebarNav />
        <div className="flex-1 overflow-y-auto px-1 py-1 space-y-1">
          {view === 'find' ? (
            <FindList />
          ) : view === 'plugins' ? (
            <PluginRegistryView />
          ) : (
            <ResourceTree groups={visible} collapsed={collapsed} />
          )}
        </div>
      </div>
    </div>
  );
}
