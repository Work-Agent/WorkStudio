/**
 * SettingsList —— 设置列表形态。
 *
 * 设置是主进程能力：清单来自 `settings.list`，页面由 WebContentsView 装载
 * （`views.open({type:'settings'})`），渲染层只负责列表与图标映射。
 */
import { useEffect, useState } from 'react';
import {
  BookOpen,
  Cpu,
  FolderOpen,
  FolderTree,
  Globe,
  HardDrive,
  MessagesSquare,
  Package,
  Puzzle,
  SlidersHorizontal,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore } from '../../state/uiState';
import { SubListView } from './SubListView';

interface SettingsPageInfo {
  id: string;
  label: string;
  desc: string;
  icon: string;
}

const ICONS: Record<string, LucideIcon> = {
  sliders: SlidersHorizontal,
  globe: Globe,
  cpu: Cpu,
  package: Package,
  puzzle: Puzzle,
  book: BookOpen,
  messages: MessagesSquare,
  folder: FolderOpen,
  'hard-drive': HardDrive,
  'folder-tree': FolderTree,
};

export function SettingsList() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const [pages, setPages] = useState<SettingsPageInfo[]>([]);

  useEffect(() => {
    void (async () => {
      const response =
        await window.workbench?.cmd<SettingsPageInfo[]>('settings.list');
      if (response?.ok) setPages(response.data);
    })();
  }, []);

  return (
    <SubListView title="设置" count={pages.length}>
      <div className="space-y-1">
        {pages.map((page) => {
          const Icon = ICONS[page.icon] ?? Settings;
          return (
            <div
              key={page.id}
              onClick={() => {
                void window.workbench?.cmd('views.open', {
                  input: { type: 'settings', pageId: page.id },
                });
              }}
              className="group flex items-center px-2 py-1.5 rounded-lg transition-colors min-h-[42px] cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]"
              title={page.label}
            >
              <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-zinc-500 text-zinc-50 dark:bg-zinc-600 dark:text-zinc-100">
                <Icon className="w-4 h-4" />
              </div>
              {!collapsed && (
                <div className="ml-2 flex-1 overflow-hidden min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate leading-none">
                      {page.label}
                    </h4>
                  </div>
                  <div className="mt-[5px] text-[12px] truncate text-zinc-400 dark:text-zinc-500 leading-none">
                    {page.desc}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!collapsed && (
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 italic px-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-700/40 mt-2">
            设置页是主进程能力，内容由 WebContentsView 承载
          </p>
        )}
      </div>
    </SubListView>
  );
}
