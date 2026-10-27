/**
 * FindList —— 侧栏「查找」形态：走 URA find 搜索工作区资源。
 *
 * 只发统一标识（ref），不碰路径与内容；点击结果按资源页面打开。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { DocumentMeta } from '../../../shared/types';
import type { ListEntry } from '../../../shared/ura';
import { agentAPI } from '../../api/bridge';
import { useTabServiceStore } from '../../state/tabService';
import { setUiState } from '../../state/uiState';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

interface Hit {
  ref: string;
  name: string;
  display: string;
}

export function FindList() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
    if (!mainBridge) return;
    void mainBridge.cmd<{ root: string }>('ura.workspace').then((res) => {
      if (res.ok && res.data?.root) setRoot(res.data.root.replace(/\/$/, ''));
    });
  }, []);

  useEffect(() => {
    if (!mainBridge) return;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const pattern = query.includes('*') ? query.trim() : `*${query.trim()}*`;
      setLoading(true);
      void mainBridge
        .cmd<ListEntry[]>('ura.find', { pattern, limit: 200 })
        .then((res) => {
          const items = res.ok ? res.data : [];
          setHits(
            items.map((item) => ({
              ref: item.ref,
              name: item.name,
              display: item.ref,
            })),
          );
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const rows = useMemo(
    () =>
      hits.map((hit) => ({
        ...hit,
        display:
          root && hit.ref.startsWith(root)
            ? hit.ref.slice(root.length + 1)
            : hit.ref,
      })),
    [hits, root],
  );

  const open = (ref: string, name: string): void => {
    const isWeb = ref.includes('/sites/');
    const domain = isWeb ? ref.split('/sites/')[1]?.split('/')[0] : undefined;
    const dot = name.lastIndexOf('.');
    const meta: DocumentMeta = {
      id: ref,
      title: name,
      path: ref,
      url: ref,
      ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
      type: 'content',
      source: isWeb ? 'web' : 'local',
      sourceLabel: isWeb ? '网站资料' : '本地文档',
      group: isWeb
        ? { id: domain ?? 'web', title: domain ?? '网站资料' }
        : { id: 'docs', title: '本地文档' },
      createdAt: 0,
    };
    if (mainBridge) {
      void mainBridge.cmd('views.openResource', { ref, document: meta });
      return;
    }
    void agentAPI.documents.open(ref).then((result) => {
      if (!result) return;
      void useTabServiceStore
        .getState()
        .openDocument(result.meta, result.content);
    });
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
                setUiState({ sidebarView: 'main' });
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
            title={row.ref}
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
