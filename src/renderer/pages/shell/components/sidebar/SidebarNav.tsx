/**
 * SidebarNav —— Sidebar 顶部视图切换（资源 / 插件 / 网站快照 / 搜索）。
 *
 * 设置入口在 TitleBar；搜索与快照都在侧栏面板内完成，不额外开标签。
 * 形态随 sidebarCollapsed：
 *   展开 = 横向图标条（直接切换）；
 *   收起（56px 图标列）= 单个「当前视图」按钮 + 原生菜单下拉。
 */
import { useEffect } from 'react';
import { ChevronDown, Files, Globe, Package, Search } from 'lucide-react';
import type { PopupMenuItem } from '../../../../../shared/types.ts';
import { popupMenu } from '../../../../shared/api/runtime.ts';
import { useScene } from '../../domains/scene.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';

type NavId = 'main' | 'plugins' | 'snapshots' | 'search';

/** 顶层形态：资源 / 插件 / 网站快照（都在左侧，同一组图标）。 */
const ITEMS = [
  { id: 'main', label: '资源', icon: Files, testId: 'sidebar-nav-resources' },
  {
    id: 'plugins',
    label: '插件',
    icon: Package,
    testId: 'sidebar-nav-plugins',
  },
  {
    id: 'snapshots',
    label: '网站快照',
    icon: Globe,
    testId: 'sidebar-nav-snapshots',
  },
] as const;

/** 唯一的搜索入口：文件 / 内容在面板内部切换。 */
const SEARCH_ITEM = {
  id: 'search',
  label: '搜索',
  icon: Search,
  testId: 'sidebar-nav-search',
} as const;

/** popup 菜单 source 标识（路由回本组件处理器）。 */
const MENU_SOURCE = 'sidebar-nav';

const isNavId = (value: string): value is NavId =>
  value === 'main' ||
  value === 'plugins' ||
  value === 'snapshots' ||
  value === 'search';

function navClass(active: boolean): string {
  return `h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-colors ${
    active
      ? 'text-[#4F6BED] dark:text-[#6c86f0] bg-[#4F6BED]/10'
      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-[#2a2d2e] hover:text-zinc-900 dark:hover:text-zinc-100'
  }`;
}

export function SidebarNav() {
  const view = useSidebarStore((s) => s.view);
  const setView = useSidebarStore((s) => s.setView);
  const { scene } = useScene();
  const collapsed = scene.sidebarCollapsed ?? false;
  const active =
    view === 'search'
      ? SEARCH_ITEM
      : (ITEMS.find((item) => item.id === view) ?? ITEMS[0]);

  // 收起态：原生菜单选中回执（source 路由）
  useEffect(() => {
    return popupMenu.onSelect((e) => {
      if (e.source !== MENU_SOURCE) return;
      if (isNavId(e.actionId)) setView(e.actionId);
    });
  }, [setView]);

  const openMenu = (): void => {
    const items: PopupMenuItem[] = [
      ...ITEMS.map((item) => ({
        id: item.id,
        label: `${view === item.id ? '✓ ' : ''}${item.label}`,
      })),
      {
        id: SEARCH_ITEM.id,
        label: `${view === SEARCH_ITEM.id ? '✓ ' : ''}${SEARCH_ITEM.label}`,
      },
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
        <>
          {ITEMS.map((item) => {
            const isActive = item.id === view;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                data-testid={item.testId}
                data-active={isActive ? 'true' : 'false'}
                title={item.label}
                onClick={() => setView(item.id)}
                className={navClass(isActive)}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              data-testid={SEARCH_ITEM.testId}
              data-active={view === 'search' ? 'true' : 'false'}
              title={SEARCH_ITEM.label}
              onClick={() => setView('search')}
              className={navClass(view === 'search')}
            >
              <SEARCH_ITEM.icon className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
