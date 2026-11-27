/**
 * SnapshotsPanel —— 侧栏里的网站快照清单。
 *
 * 清单与正文都来自 `web/web` 的命令（list / doc）：这里只做列表与新增，
 * 点条目在中间打开只读快照页；采集现场仍在浏览器标签里。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Clock,
  Globe,
  Loader2,
  Plus,
  ScanLine,
  X,
} from 'lucide-react';
import {
  command,
  useWorkspaceId,
  workStudio,
} from '../../../../shared/api/bridge.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';

interface SnapshotItem {
  url: string;
  title: string;
  capturedAt: number;
  ref: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function timeOf(value: number): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 只接受 http(s)：其它协议不进浏览器。 */
function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const RAIL_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-[#2a2d2e] dark:hover:text-zinc-100';

export function SnapshotsPanel({
  collapsed = false,
  onExpand,
}: {
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const wsId = useWorkspaceId();
  const [items, setItems] = useState<SnapshotItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'open' | 'capture' | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback((): void => {
    void command<SnapshotItem[]>('web', 'web', 'list', {})
      .then((list) => {
        setItems(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorText(reason)));
  }, []);

  useEffect(() => {
    const bridge = workStudio();
    if (!bridge) return;
    let disposed = false;
    reload();
    // 变更只推给订阅者：先订阅 web/web，缓存写入才能让清单刷新。
    const off = bridge.onUpdate((update) => {
      if (update.domain === 'web' && update.resource === 'web') reload();
    });
    void bridge.subscribe('web', 'web').then(() => {
      if (!disposed) reload();
    });
    return () => {
      disposed = true;
      off();
      bridge.unsubscribe('web', 'web');
    };
  }, [reload]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  /** 打开一条快照：固定 id = 快照地址，重复打开只聚焦。 */
  const openSnapshot = (item: SnapshotItem): void => {
    if (!wsId) return;
    void command('shell', `${wsId}/views`, 'open', {
      id: item.ref,
      type: 'page',
      title: item.title || hostOf(item.url),
      url: item.ref,
    }).catch((reason: unknown) => notifyError(errorText(reason), 'snapshots'));
  };

  /** 采集：打开实时页 → 写入缓存 → 打开快照页。 */
  const capture = async (): Promise<void> => {
    if (!wsId) return;
    const url = normalizeUrl(value);
    if (!url) {
      notifyError('请输入有效的网址（http / https）', 'snapshots');
      return;
    }
    setBusy('capture');
    try {
      await command('browser', `${wsId}/tabs`, 'open', { url });
      const saved = await command<{ ref: string }>('web', 'web', 'capture', {
        url,
      });
      setAdding(false);
      setValue('');
      reload();
      openSnapshot({ url, title: url, capturedAt: Date.now(), ref: saved.ref });
    } catch (reason) {
      notifyError(errorText(reason), 'snapshots');
    } finally {
      setBusy(null);
    }
  };

  const openOnly = async (): Promise<void> => {
    if (!wsId) return;
    const url = normalizeUrl(value);
    if (!url) {
      notifyError('请输入有效的网址（http / https）', 'snapshots');
      return;
    }
    setBusy('open');
    try {
      await command('browser', `${wsId}/tabs`, 'open', { url });
    } catch (reason) {
      notifyError(errorText(reason), 'snapshots');
    } finally {
      setBusy(null);
    }
  };

  const ready =
    busy === null && normalizeUrl(value) !== null && value.trim() !== '';

  if (collapsed) {
    return (
      <div
        data-testid="snapshots-rail"
        className="flex flex-col items-center gap-1 pt-1"
      >
        <button
          type="button"
          data-testid="snapshots-add"
          title="新增采集"
          onClick={() => {
            setAdding(true);
            onExpand?.();
          }}
          className={RAIL_BUTTON}
        >
          <Plus className="h-4 w-4" />
        </button>
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            data-testid="snapshots-row"
            title={item.title || hostOf(item.url)}
            onClick={() => openSnapshot(item)}
            className={RAIL_BUTTON}
          >
            <Globe className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="snapshots-panel" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          网站快照
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {error ? (
          <div className="px-2 py-2 text-[11px] text-red-500">{error}</div>
        ) : items.length === 0 ? (
          <div
            data-testid="snapshots-empty"
            className="px-2 py-2 text-[11px] text-zinc-400 dark:text-zinc-500"
          >
            还没有采集任何网页
          </div>
        ) : (
          <div data-testid="snapshots-list" className="space-y-0.5">
            {items.map((item) => (
              <button
                key={item.url}
                type="button"
                data-testid="snapshots-row"
                onClick={() => openSnapshot(item)}
                title={`${item.title || item.url}\n${item.url}`}
                className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-zinc-200/60 dark:hover:bg-[#2a2d2e]"
              >
                <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-zinc-700 dark:text-zinc-200">
                    {item.title || hostOf(item.url)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                    {hostOf(item.url)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-zinc-500">
                  <Clock className="h-2.5 w-2.5" />
                  {timeOf(item.capturedAt)}
                </span>
                <ArrowUpRight className="h-3 w-3 shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500 dark:text-zinc-600" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-1 pt-1 pb-1">
        {adding ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-1.5 dark:border-[#303436] dark:bg-[#141618]">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                新增采集
              </span>
              <button
                type="button"
                data-testid="snapshots-cancel"
                title="取消"
                onClick={() => setAdding(false)}
                className="flex h-4 w-4 items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <input
              ref={inputRef}
              data-testid="snapshots-url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && ready) void capture();
                if (event.key === 'Escape') setAdding(false);
              }}
              placeholder="https://example.com"
              spellCheck={false}
              autoComplete="off"
              className="mb-1 h-8 w-full min-w-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 font-mono text-[11px] outline-none transition-colors placeholder:text-zinc-400 focus:border-[#4F6BED] dark:border-[#303436] dark:bg-[#101214]"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="snapshots-capture"
                disabled={!ready}
                onClick={() => void capture()}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-[#4F6BED] text-[11px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'capture' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ScanLine className="h-3 w-3" />
                )}
                采集
              </button>
              <button
                type="button"
                data-testid="snapshots-open"
                disabled={!ready}
                onClick={() => void openOnly()}
                className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-[11px] text-zinc-600 transition-colors hover:border-[#4F6BED]/60 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#303436] dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                {busy === 'open' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowUpRight className="h-3 w-3" />
                )}
                仅打开
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="snapshots-add"
            onClick={() => setAdding(true)}
            className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 text-[11px] text-zinc-500 transition-colors hover:border-[#4F6BED]/60 hover:text-zinc-800 dark:border-[#303436] dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <Plus className="h-3 w-3" />
            新增
          </button>
        )}
      </div>
    </div>
  );
}
