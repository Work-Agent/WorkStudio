/**
 * GrepList —— 侧栏「搜索内容」形态：走 URA grep 检索工作区内容。
 *
 * 与 FindList 是两个独立入口；结果按文件分组，点击打开文件。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, TextSearch } from 'lucide-react';
import type { Item, ResourceNode } from '@work-studio/sdk';
import { displayPath } from '../../../../shared/api/pathDisplay.ts';
import { command } from '../../../../shared/api/bridge.ts';
import { openResourceNode } from '../../../../shared/domains/resources.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';
import {
  useWindowWorkspaceId,
  useWorkspaces,
} from '../../../../shared/domains/workspaces.ts';

interface Match {
  ref: string;
  locator: string;
  name: string;
  line: number | null;
  snippet: string;
}

interface Group {
  ref: string;
  name: string;
  display: string;
  matches: Match[];
}

export function GrepList() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const request = useRef(0);

  const { current } = useWorkspaces();
  const workspaceId = useWindowWorkspaceId();
  useEffect(() => {
    inputRef.current?.focus();
  }, [current?.path]);

  useEffect(() => {
    if (!query.trim()) {
      request.current += 1;
      setHits([]);
      setError('');
      setLoading(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!workspaceId) return;
      const id = ++request.current;
      setLoading(true);
      setError('');
      void command<Item[]>('workspace', `${workspaceId}/search`, 'grep', {
        query: query.trim(),
      })
        .then((items) => {
          if (request.current !== id) return;
          setHits(
            items.flatMap((item) => {
              const ref = typeof item.ref === 'string' ? item.ref : '';
              if (!ref || typeof item.locator !== 'string') return [];
              return [
                {
                  ref,
                  locator: item.locator,
                  name: nameOf(ref),
                  line: typeof item.line === 'number' ? item.line : null,
                  snippet: typeof item.snippet === 'string' ? item.snippet : '',
                },
              ];
            }),
          );
        })
        .catch((reason: unknown) => {
          if (request.current !== id) return;
          setHits([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (request.current === id) setLoading(false);
        });
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, current?.id, workspaceId]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const hit of hits) {
      let group = map.get(hit.ref);
      if (!group) {
        group = {
          ref: hit.ref,
          name: hit.name,
          display: displayPath(hit.ref),
          matches: [],
        };
        map.set(hit.ref, group);
      }
      group.matches.push(hit);
    }
    return [...map.values()];
  }, [hits]);

  const open = (ref: string, name: string, locator?: string): void => {
    const item: ResourceNode = {
      key: ref,
      type: 'file',
      title: name,
      meta: { ref, ...(locator ? { locator } : {}) },
    };
    void openResourceNode(item).catch((reason: unknown) =>
      notifyError(
        reason instanceof Error ? reason.message : String(reason),
        'open',
      ),
    );
  };

  const total = hits.length;

  return (
    <div className="flex flex-col h-full" data-testid="sidebar-grep">
      <div className="px-2 pt-1 pb-2">
        <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg border border-zinc-300 dark:border-[#2a2d2e] bg-white dark:bg-[#202124]">
          <TextSearch className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            data-testid="sidebar-grep-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
                useSidebarStore.getState().setView('main');
              }
              if (event.key === 'Enter' && groups[0])
                open(
                  groups[0].ref,
                  groups[0].name,
                  groups[0].matches[0]?.locator,
                );
            }}
            placeholder="搜索文件内容…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
          />
        </div>
        <div className="mt-1.5 px-1 text-[10.5px] text-zinc-400 dark:text-zinc-600 select-none">
          {loading
            ? '搜索中…'
            : error
              ? error
              : query.trim()
                ? `${groups.length} 个文件 · ${total} 处匹配`
                : '搜索文件内容（支持正则）'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-1">
        {groups.map((group) => (
          <div key={group.ref}>
            <div
              data-testid="sidebar-grep-group"
              title={group.ref}
              onClick={() =>
                open(group.ref, group.name, group.matches[0]?.locator)
              }
              className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-[11.5px] font-medium text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-[#2a2d2e] transition-colors"
            >
              <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">{group.display}</span>
              <span className="shrink-0 text-[10px] text-zinc-400">
                {group.matches.length}
              </span>
            </div>
            {group.matches.map((match, index) => (
              <div
                key={`${match.locator}-${index}`}
                data-testid="sidebar-grep-item"
                title={displayPath(match.locator)}
                onClick={() => open(match.ref, match.name, match.locator)}
                className="flex items-start gap-2 pl-5 pr-2 py-1 rounded-md cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e] transition-colors"
              >
                <span className="w-8 shrink-0 pt-0.5 text-right font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                  {match.line ?? ''}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-tight text-zinc-600 dark:text-zinc-300">
                  {match.snippet || '（无预览）'}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!loading && query.trim() !== '' && groups.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-zinc-400 dark:text-zinc-600 italic">
            {error ? '搜索失败，请检查正则。' : '没有匹配的内容。'}
          </p>
        )}
      </div>
    </div>
  );
}

function nameOf(ref: string): string {
  try {
    const path = decodeURIComponent(ref.replace(/^file:\/\//, ''));
    return path.slice(path.lastIndexOf('/') + 1) || ref;
  } catch {
    return ref;
  }
}
