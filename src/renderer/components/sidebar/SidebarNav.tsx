/**
 * SidebarNav —— Sidebar 顶部视图切换（资源 / 插件 / 设置）。
 *
 * 形态随 sidebarCollapsed：
 *   展开 = 横向三图标条（直接切换）；
 *   收起（56px 图标列）= 单个「当前视图」按钮 + 原生菜单下拉（DOM 弹层会越出
 *   侧栏被原生视图遮挡，故走 Menu.popup）。
 * 激活位取 `ui-state.sidebarView`：main 家族的二级形态（docs / web…）仍高亮「资源」。
 */
import { useEffect } from 'react';
import { ChevronDown, Files, Package, Search, Settings } from 'lucide-react';
import type { PopupMenuItem } from '../../../shared/types';
import { popupMenu } from '../../api/runtime';
import { setUiState, useUiStore } from '../../state/ui';

/** 顶层形态（二级形态 docs / data / web 属于 main 家族）。 */
const ITEMS = [
  { id: 'main', label: '资源', icon: Files, testId: 'sidebar-nav-resources' },
  {
    id: 'plugins',
    label: '插件',
    icon: Package,
    testId: 'sidebar-nav-plugins',
  },
  {
    id: 'settings',
    label: '设置',
    icon: Settings,
    testId: 'sidebar-nav-settings',
  },
] as const;

type NavId = (typeof ITEMS)[number]['id'];

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'sidebar-nav';

const isNavId = (value: string): value is NavId =>
  value === 'main' || value === 'plugins' || value === 'settings';

export function SidebarNav() {
  const view = useUiStore((s) => s.sidebarView);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const activeId: NavId | null =
    view === 'plugins'
      ? 'plugins'
      : view === 'settings'
        ? 'settings'
        : view === 'find'
          ? null
          : 'main';
  const active = ITEMS.find((i) => i.id === activeId) ?? ITEMS[0];

  // 收起态：原生菜单选中回执（source 路由）
  useEffect(() => {
    return popupMenu.onSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      if (e.actionId === 'find') setUiState({ sidebarView: 'find' });
      else if (isNavId(e.actionId)) setUiState({ sidebarView: e.actionId });
    });
  }, []);

  const openMenu = (): void => {
    const items: PopupMenuItem[] = [
      ...ITEMS.map((item) => ({
        id: item.id,
        label: `${item.id === activeId ? '✓ ' : ''}${item.label}`,
      })),
      { id: 'find', label: `${view === 'find' ? '✓ ' : ''}查找` },
    ];
    void popupMenu.show({ source: MENU_SOURCE, items });
  };

  return (
    <div
      data-testid="sidebar-nav"
      className={`shrink-0 h-9 flex border-b border-zinc-200 dark:border-zinc-800 ${
        collapsed
          ? 'items-center justify-center px-1'
          : 'items-center gap-0.5 px-1.5'
      }`}
    >
      {collapsed ? (
        <button
          data-testid="sidebar-nav-menu"
          data-active="true"
          title={`视图：${active.label}（点击切换）`}
          onClick={openMenu}
          className="h-7 px-1.5 shrink-0 rounded-md flex items-center gap-0.5 text-[#4F6BED] dark:text-[#6c86f0] bg-[#4F6BED]/10 hover:bg-[#4F6BED]/15 transition-colors"
        >
          <active.icon className="w-4 h-4" />
          <ChevronDown className="w-3 h-3 opacity-70" />
        </button>
      ) : (
        ITEMS.map((item) => {
          const isActive = item.id === activeId;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              data-testid={item.testId}
              data-active={isActive ? 'true' : 'false'}
              title={item.label}
              onClick={() => setUiState({ sidebarView: item.id })}
              className={`h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-colors ${
                isActive
                  ? 'text-[#4F6BED] dark:text-[#6c86f0] bg-[#4F6BED]/10'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })
      )}
      {!collapsed && (
        <button
          data-testid="sidebar-nav-find"
          data-active={view === 'find' ? 'true' : 'false'}
          title={view === 'find' ? '退出查找' : '查找资源'}
          onClick={() =>
            setUiState({ sidebarView: view === 'find' ? 'main' : 'find' })
          }
          className={`ml-auto h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-colors ${
            view === 'find'
              ? 'text-[#4F6BED] dark:text-[#6c86f0] bg-[#4F6BED]/10'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
        >
          <Search className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
