/**
 * SearchPanel —— 侧栏唯一的搜索入口：文件 / 内容在面板内部切换。
 *
 * 外面只有一个搜索按钮：检索模式属于搜索这件事本身，不该占两个导航位。
 * 返回键回到资源树（`main`）；
 */
import { ChevronLeft, FileSearch, TextSearch } from 'lucide-react';
import { useSidebarStore, type SearchMode } from '../../domains/sidebar.ts';
import { FindList } from './FindList.tsx';
import { GrepList } from './GrepList.tsx';

const MODES: Array<{
  id: SearchMode;
  label: string;
  icon: typeof FileSearch;
  testId: string;
}> = [
  { id: 'files', label: '文件', icon: FileSearch, testId: 'search-mode-files' },
  {
    id: 'content',
    label: '内容',
    icon: TextSearch,
    testId: 'search-mode-content',
  },
];

export function SearchPanel() {
  const mode = useSidebarStore((s) => s.searchMode);
  const setMode = useSidebarStore((s) => s.setSearchMode);
  const setView = useSidebarStore((s) => s.setView);

  return (
    <div data-testid="sidebar-search" className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-1 pb-1">
        <button
          type="button"
          data-testid="sidebar-back"
          title="返回资源"
          onClick={() => setView('main')}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#2a2d2e] dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-[#23272a]">
          {MODES.map((item) => {
            const active = item.id === mode;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={item.testId}
                data-active={active ? 'true' : 'false'}
                title={item.id === 'files' ? '按文件名查找' : '按内容搜索'}
                onClick={() => setMode(item.id)}
                className={`flex h-6 cursor-pointer items-center justify-center gap-1 rounded px-2 text-[11px] transition-colors ${
                  active
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-[#2f3336] dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'files' ? <FindList /> : <GrepList />}
      </div>
    </div>
  );
}
