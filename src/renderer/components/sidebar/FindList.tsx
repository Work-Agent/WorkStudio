/**
 * FindList —— 侧栏「查找」形态：走 URA find 搜索工作区资源。
 *
 * 只发统一标识（ref），不碰路径与内容；点击结果按资源页面打开。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { ListItem } from '../../../shared/lists';
import { displayPath } from '../../api/pathDisplay';
import type { ListEntry } from '../../../shared/ura';
import { cmd } from '../../api/appCommands';
import { notifyError } from '../../state/notifications';
import { setUiState } from '../../state/ui';

interface Hit {
  ref: string;
  name: string;
  display: string;
}

export function FindList({
  query: controlled,
  hideInput = false,
}: {
  query?: string;
  hideInput?: boolean;
}) {
  const [localQuery, setQuery] = useState('');
  const query = controlled ?? localQuery;
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    let current = true;
    timer.current = setTimeout(() => {
      const pattern = query.includes('*') ? query.trim() : `*${query.trim()}*`;
      setLoading(true);
      void cmd<ListEntry[]>('ura.find', { pattern, limit: 200 })
        .then((res) => {
          if (!current) return;
          const items = res.ok ? res.data : [];
          setHits(
            items.map((item) => ({
              ref: item.ref,
              name: item.name,
              display: item.ref,
            })),
          );
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const rows = useMemo(
    () =>
      hits.map((hit) => ({
        ...hit,
        display: displayPath(hit.ref),
      })),
    [hits],
  );

  const open = (ref: string, name: string): void => {
    const item: ListItem = {
      key: ref,
      itemType: 'document',
      title: name,
      meta: { ref },
    };
    void cmd('list.action', { action: 'open', item }).then((result) => {
      if (!result.ok) notifyError(result.error.message, 'open');
    });
  };

  return (
    <div className="flex flex-col h-full" data-testid="sidebar-find">
      <div className="px-2 pt-1 pb-2" hidden={hideInput}>
        <div className="flex items-center gap-1.5 h-8 px-2 rounded-lg border border-[var(--biz-border)] dark:border-[var(--biz-border)] bg-[var(--biz-surface)]">
          <Search className="w-3.5 h-3.5 text-[var(--biz-text-muted)] shrink-0" />
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
            aria-label="查找资料"
            placeholder="按名称或路径查找…"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-[var(--biz-text)] placeholder:text-[var(--biz-text-muted)]"
          />
        </div>
        <div className="mt-1.5 px-1 text-[10.5px] text-[var(--biz-text-muted)] select-none">
          {loading
            ? '查找中…'
            : query.trim()
              ? `${rows.length} 个结果`
              : '输入名称或路径片段（支持 * 通配）'}
        </div>
      </div>
      {hideInput && (
        <p
          role="status"
          className="px-2 pb-2 text-[11px] text-[var(--biz-text-muted)]"
        >
          {loading ? '查找中…' : `${rows.length} 个结果 · 按名称或路径匹配`}
        </p>
      )}
      <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-0.5">
        {rows.map((row) => (
          <button
            type="button"
            key={row.ref}
            data-testid="sidebar-find-item"
            title={displayPath(row.ref)}
            onClick={() => open(row.ref, row.name)}
            className="flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--biz-surface)] dark:hover:bg-[var(--biz-surface)] transition-colors"
          >
            <FileText className="w-4 h-4 mt-0.5 shrink-0 text-[var(--biz-text-muted)]" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] leading-tight text-[var(--biz-text)] truncate">
                {row.name}
              </div>
              <div className="mt-1 text-[10.5px] leading-tight text-[var(--biz-text-muted)] truncate">
                {row.display}
              </div>
            </div>
          </button>
        ))}
        {!loading && query.trim() !== '' && rows.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-[var(--biz-text-muted)] italic">
            没有匹配的资源。
          </p>
        )}
      </div>
    </div>
  );
}
