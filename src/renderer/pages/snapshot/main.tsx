/**
 * 网页快照页：只读展示缓存里的 Markdown 正文。
 *
 * 地址 `work://studio/snapshot?url=<原地址>` 与 `WebCache.refOf` 一致；
 * 正文来自 `web/web` 的 doc 命令，页面自己不做提取。
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Clock, Globe } from 'lucide-react';
import {
  command,
  useWorkspaceId,
  workStudio,
} from '../../shared/api/bridge.ts';
import { notifyError } from '../../shared/domains/notices.ts';
import { ToastHost } from '../../shared/domains/toast-host.tsx';
import { renderMarkdown } from '../../shared/markdown.ts';
import '../../shared/styles/index.css';

interface SnapshotDoc {
  url: string;
  title: string;
  markdown: string;
  capturedAt: number;
}

function sourceUrl(): string {
  const value = new URLSearchParams(location.search).get('url') ?? '';
  return value;
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Snapshot() {
  const wsId = useWorkspaceId();
  const url = useMemo(sourceUrl, []);
  const [doc, setDoc] = useState<SnapshotDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let disposed = false;
    const load = (): void => {
      void command<SnapshotDoc>('web', 'web', 'doc', { url })
        .then((next) => {
          if (!disposed) setDoc(next);
        })
        .catch((reason: unknown) => {
          if (!disposed) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        });
    };
    load();
    // 同一地址重新采集时缓存会更新：订阅 web/web 后重新取一次。
    const bridge = workStudio();
    if (!bridge) return;
    const off = bridge.onUpdate((update) => {
      if (update.domain === 'web' && update.resource === 'web') load();
    });
    void bridge.subscribe('web', 'web');
    return () => {
      disposed = true;
      off();
      bridge.unsubscribe('web', 'web');
    };
  }, [url]);

  const openLive = (): void => {
    if (!wsId || !url) return;
    void command('browser', `${wsId}/tabs`, 'open', { url }).catch(
      (reason: unknown) =>
        notifyError(
          reason instanceof Error ? reason.message : String(reason),
          'snapshot',
        ),
    );
  };

  if (!url) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-100 text-[12px] text-zinc-500 dark:bg-[#1a1c1d] dark:text-zinc-400">
        快照地址缺少 url 参数
      </div>
    );
  }

  return (
    <div
      data-testid="snapshot-page"
      className="h-screen overflow-y-auto bg-zinc-100 text-zinc-900 dark:bg-[#1a1c1d] dark:text-zinc-100"
    >
      <div className="mx-auto max-w-[860px] px-8 py-8">
        <div className="mb-6 border-b border-zinc-200 pb-5 dark:border-[#2c3039]">
          <h1
            data-testid="snapshot-title"
            className="text-[20px] font-semibold leading-7"
          >
            {doc?.title || '网页快照'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3 w-3" />
              <span data-testid="snapshot-host" className="font-mono">
                {hostOf(url)}
              </span>
            </span>
            {doc?.capturedAt ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeOf(doc.capturedAt)}
              </span>
            ) : null}
            <button
              type="button"
              data-testid="snapshot-open-live"
              onClick={openLive}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[#4F6BED] transition-colors hover:bg-[#4F6BED]/10 dark:text-[#6c86f0]"
            >
              <ArrowUpRight className="h-3 w-3" />
              打开实时网页
            </button>
          </div>
        </div>

        {error ? (
          <div className="text-[12px] text-red-500">{error}</div>
        ) : doc ? (
          <article
            data-testid="snapshot-body"
            className="snapshot-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.markdown) }}
          />
        ) : (
          <div className="text-[12px] text-zinc-400">正在读取快照…</div>
        )}
      </div>
      <ToastHost />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Snapshot />);
