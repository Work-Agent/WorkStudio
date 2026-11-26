/**
 * FindList —— 侧栏「查找」形态：走 URA find 搜索工作区资源。
 *
 * 只发统一标识（ref），不碰路径与内容；点击结果按资源页面打开。
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { ResourceNode } from '../../../../../shared/resources.ts';
import { displayPath } from '../../../../shared/api/pathDisplay.ts';
import type { Entry } from '@work-studio/sdk';
import { command } from '../../../../shared/api/bridge.ts';
import { openResourceNode } from '../../../../shared/domains/resources.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';
import {
  useWindowWorkspaceId,
  useWorkspaces,
} from '../../../../shared/domains/workspaces.ts';

interface Hit {
  ref: string;
  name: string;
  display: string;
}

export function FindList() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { current } = useWorkspaces();
  const workspaceId = useWindowWorkspaceId();
  useEffect(() => {
    inputRef.current?.focus();
  }, [current?.path]);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const pattern = query.includes('*') ? query.trim() : `*${query.trim()}*`;
      setLoading(true);
      if (!workspaceId) return;
      void command<Entry[]>('workspace', `${workspaceId}/search`, 'find', {
        query: pattern,
      })
        .then((items) => {
          setHits(
            items.map((item) => ({
              ref: item.ref,
              name: item.name,
              display: displayPath(item.ref),
            })),
          );
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, current?.id]);

  const rows = hits;

  const open = (ref: string, name: string): void => {
    const item: ResourceNode = {
      key: ref,
      type: 'file',
      title: name,
      meta: { ref },
    };
    void openResourceNode(item).catch((error: unknown) =>
      notifyError(
        error instanceof Error ? error.message : String(error),
        'open',
      ),
    );
  };

  return (
    <div className="flex flex-col h-full" data-testid="sidebar-find">
      <div className="px-2 pt-1 pb-2">
        <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg border border-zinc-300 dark:border-[#2a2d2e] bg-white dark:bg-[#202124]">
          <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            data-testid="sidebar-find-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
                useSidebarStore.getState().setView('main');
              }
              if (event.key === 'Enter' && rows[0])
                open(rows[0].ref, rows[0].name);
            }}
            placeholder="搜索项目资源…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </div>
        <div className="mt-1.5 px-1 text-[10.5px] text-zinc-400 dark:text-zinc-600 select-none">
          {loading
            ? '查找中…'
            : query.trim()
              ? `${rows.length} 个结果`
              : '输入名称或路径片段（支持 * 通配）'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-0.5">
        {rows.map((row) => (
          <div
            key={row.ref}
            data-testid="sidebar-find-item"
            title={displayPath(row.ref)}
            onClick={() => open(row.ref, row.name)}
            className="flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e] transition-colors"
          >
            <FileText className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] leading-tight text-zinc-800 dark:text-zinc-100 truncate">
                {row.name}
              </div>
              <div className="mt-1 text-[10.5px] leading-tight text-zinc-400 dark:text-zinc-500 truncate">
                {row.display}
              </div>
            </div>
          </div>
        ))}
        {!loading && query.trim() !== '' && rows.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-zinc-400 dark:text-zinc-600 italic">
            没有匹配的资源。
          </p>
        )}
      </div>
    </div>
  );
}
