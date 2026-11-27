/**
 * PluginRegistryView —— 插件注册表（App 级）。
 *
 * 与 workspace 资源森林完全分开：已安装 / 可安装、安装卸载、任务进度都在这里。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Download, Package, Plus } from 'lucide-react';
import type {
  PluginRegistryEntry,
  PluginRegistrySnapshot,
} from '@work-studio/sdk';
import { command, useResource } from '../../../../shared/api/bridge.ts';
import { useSidebarStore } from '../../domains/sidebar.ts';
import { notifyError } from '../../../../shared/domains/notices.ts';
import { rendererIcon } from '../titlebar/icons.ts';

const INITIAL: PluginRegistrySnapshot = {
  revision: 0,
  installed: [],
  available: [],
  catalog: { fetchedAt: null, stale: false },
  task: null,
};

const STAGE_LABEL: Record<string, string> = {
  ready: '运行中',
  installed: '已安装',
  error: '加载失败',
  broken: '包损坏',
};

const BUTTON =
  'cursor-pointer whitespace-nowrap rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#303436] dark:text-zinc-300 dark:hover:bg-[#23272a]';

const PRIMARY =
  'cursor-pointer whitespace-nowrap rounded-md border border-[#4F6BED] bg-[#4F6BED] px-1.5 py-0.5 text-[11px] text-white transition-colors hover:bg-[#3D56E0] disabled:cursor-not-allowed disabled:opacity-40';

const ICON_BUTTON =
  'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-[#303436] dark:text-zinc-300 dark:hover:bg-[#23272a]';

const RAIL_BUTTON =
  'relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-zinc-200 text-[11px] font-medium text-zinc-600 transition-colors hover:border-[#4F6BED]/60 hover:bg-zinc-100 dark:border-[#303436] dark:text-zinc-300 dark:hover:bg-[#23272a]';

function iconOf(entry: PluginRegistryEntry) {
  return rendererIcon(entry.icon) ?? Package;
}

function ago(value: number | null): string {
  if (!value) return '尚未加载';
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function PluginRegistryView({
  collapsed = false,
  onExpand,
}: {
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const state = useResource<PluginRegistrySnapshot>(
    'plugin',
    'registry',
    INITIAL,
  );
  const setView = useSidebarStore((s) => s.setView);
  const [source, setSource] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const task = state.task;
  const running = task?.status === 'running';
  const locked = busy || running;

  const act = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      setError('');
      setBusy(true);
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      notifyError(message, 'plugin');
    } finally {
      setBusy(false);
    }
  };

  const run = (action: string, input?: unknown): Promise<unknown> =>
    command('plugin', 'registry', action, input);

  // 进面板就同步一次目录：用户不该先看到一个「未加载」的中间态。
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || state.catalog.fetchedAt) return;
    synced.current = true;
    void act(() => run('refresh'));
  }, [state.catalog.fetchedAt]);

  // 装成功不留「安装完成 x/x」的卡片：结果已经在已安装列表里。
  // 失败 / 取消保留，那才是用户唯一线索。
  useEffect(() => {
    if (!task || task.status !== 'ready') return;
    const timer = setTimeout(() => {
      void run('clearTask').catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [task?.id, task?.status]);

  const install = (entry: PluginRegistryEntry): Promise<void> =>
    act(() => run('install', { id: entry.id }));

  const update = (entry: PluginRegistryEntry): Promise<void> =>
    act(() => run('install', { id: entry.id }));

  const remove = (entry: PluginRegistryEntry): Promise<void> =>
    act(async () => {
      if (!window.confirm(`卸载「${entry.name}」？`)) return;
      await run('remove', { id: entry.id });
    });

  const reload = (entry: PluginRegistryEntry): Promise<void> =>
    act(() => run('reload', { id: entry.id }));

  const open = (entry: PluginRegistryEntry): Promise<void> =>
    act(() => run('open', { id: entry.id }));

  const openAvailable = (entry: PluginRegistryEntry): Promise<void> =>
    act(async () => {
      if (
        entry.state === 'available' &&
        !window.confirm(`安装「${entry.name}」并打开插件主页？`)
      ) {
        return;
      }
      await run('install', { id: entry.id });
      await run('open', { id: entry.id });
    });

  const installManual = (): Promise<void> =>
    act(async () => {
      await run('installSource', { source });
      setSource('');
    });

  const pickFile = (): Promise<void> =>
    act(async () => {
      const picked = await command<string | null>(
        'shell',
        'native',
        'pickFile',
        { extensions: 'zip' },
      );
      if (picked) setSource(picked);
    });

  const progress =
    task && task.total
      ? Math.min(100, Math.round((task.received / task.total) * 100))
      : null;

  if (collapsed) {
    return (
      <div
        data-testid="plugin-registry-rail"
        className="flex flex-col items-center gap-1 pt-1"
      >
        <button
          type="button"
          title="手动安装"
          onClick={() => {
            setManualOpen(true);
            onExpand?.();
          }}
          className={RAIL_BUTTON}
        >
          <Plus className="h-4 w-4" />
        </button>
        {state.installed.map((entry) => {
          const Icon = iconOf(entry);
          return (
            <button
              key={entry.id}
              type="button"
              data-testid="plugin-registry-rail-installed"
              title={`${entry.name} v${entry.version}${entry.error ? ` · ${entry.error}` : ''}`}
              onClick={() => void open(entry)}
              className={RAIL_BUTTON}
            >
              <Icon className="h-4 w-4" />
              {entry.error && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
        {state.available.length > 0 && (
          <button
            type="button"
            title={`${state.available.length} 个可安装`}
            onClick={onExpand}
            className={RAIL_BUTTON}
          >
            <Download className="h-4 w-4" />
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#4F6BED] px-1 text-[9px] text-white">
              {state.available.length}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="plugin-registry"
      className="flex flex-col gap-2 px-1 pb-2 text-[12px]"
    >
      <div className="flex items-center gap-1 px-1 pt-1">
        <button
          type="button"
          data-testid="sidebar-back"
          title="返回资源"
          onClick={() => setView('main')}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-[#2a2d2e] dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400"
          title={
            state.catalog.fetchedAt
              ? '插件目录来自注册表'
              : '插件目录来自注册表，点右侧「刷新」同步'
          }
        >
          {state.catalog.fetchedAt
            ? `${ago(state.catalog.fetchedAt)}更新`
            : '插件目录未加载'}
          {state.catalog.stale ? ' · 离线缓存' : ''}
        </span>
        <button
          type="button"
          data-testid="plugin-registry-manual-toggle"
          aria-expanded={manualOpen}
          title={manualOpen ? '收起手动安装' : '手动安装'}
          onClick={() => setManualOpen((open) => !open)}
          className={ICON_BUTTON}
        >
          <Plus
            className={`h-3.5 w-3.5 transition-transform ${manualOpen ? 'rotate-45' : ''}`}
          />
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => void act(() => run('refresh'))}
          className={`${BUTTON} h-6`}
        >
          刷新
        </button>
      </div>
      {state.catalog.error && (
        <p className="px-1 text-[11px] text-red-500">{state.catalog.error}</p>
      )}

      {manualOpen && (
        <div
          data-testid="plugin-registry-manual"
          className="rounded-lg border border-zinc-200 p-2 dark:border-[#2c3039]"
        >
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="URL / zip / 目录"
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={locked || !source.trim()}
              className={BUTTON}
              onClick={() => void installManual()}
            >
              安装
            </button>
            <button
              type="button"
              disabled={locked}
              className={BUTTON}
              onClick={() => void pickFile()}
            >
              zip
            </button>
          </div>
        </div>
      )}

      {task && (
        <div className="rounded-lg border border-zinc-200 p-2 dark:border-[#2c3039]">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{task.label}</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {task.message}
                {task.total ? ` · ${task.received}/${task.total}` : ''}
              </div>
            </div>
            {task.status === 'running' &&
              task.phase !== 'commit' &&
              task.phase !== 'activate' && (
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => void act(() => run('cancel'))}
                >
                  取消
                </button>
              )}
            {task.status !== 'running' && (
              <button
                type="button"
                className={BUTTON}
                onClick={() => void act(() => run('clearTask'))}
              >
                关闭
              </button>
            )}
          </div>
          {task.status === 'running' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-100 dark:bg-[#23272a]">
              <div
                className="h-full bg-[#4F6BED] transition-[width]"
                style={{
                  width: progress === null ? '100%' : `${progress}%`,
                  opacity: progress === null ? 0.25 : 1,
                }}
              />
            </div>
          )}
          {task.error && (
            <div className="mt-1 text-[11px] text-red-500">{task.error}</div>
          )}
        </div>
      )}

      <section>
        <h3 className="mb-1 px-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          已安装 · {state.installed.length}
        </h3>
        <div className="space-y-1">
          {state.installed.map((entry) => {
            const Icon = iconOf(entry);
            return (
              <div
                key={entry.id}
                data-testid="plugin-registry-installed"
                data-plugin-id={entry.id}
                title="打开插件设置"
                onClick={() => void open(entry)}
                className="cursor-pointer rounded-lg border border-zinc-200 px-2 py-1.5 transition-colors hover:border-[#4F6BED]/60 dark:border-[#2c3039]"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-[#23272a] dark:text-zinc-400">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {entry.name}
                      </span>
                      {entry.builtin && (
                        <span className="shrink-0 rounded bg-indigo-50 px-1 text-[10px] text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400">
                          内置
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-zinc-400">
                      <span className="truncate">
                        v{entry.version} · {entry.id}
                      </span>
                      <span className="shrink-0 font-sans">
                        {STAGE_LABEL[entry.stage ?? ''] ?? entry.stage ?? ''}
                      </span>
                    </div>
                    {entry.error && (
                      <div className="mt-0.5 text-[11px] text-red-500">
                        {entry.error}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      disabled={locked}
                      className={BUTTON}
                      onClick={(event) => {
                        event.stopPropagation();
                        void reload(entry);
                      }}
                    >
                      重载
                    </button>
                    {!entry.builtin && (
                      <button
                        type="button"
                        disabled={locked}
                        className={BUTTON}
                        onClick={(event) => {
                          event.stopPropagation();
                          void remove(entry);
                        }}
                      >
                        卸载
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {state.installed.length === 0 && (
            <p className="px-1 text-[11px] text-zinc-400">暂无已安装插件</p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 px-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          可安装 · {state.available.length}
        </h3>
        <div className="space-y-1">
          {state.available.map((entry) => {
            const Icon = iconOf(entry);
            return (
              <div
                key={entry.id}
                data-testid="plugin-registry-available"
                title="安装并打开插件主页"
                onClick={() => void openAvailable(entry)}
                className="cursor-pointer rounded-lg border border-zinc-200 px-2 py-1.5 transition-colors hover:border-[#4F6BED]/60 dark:border-[#2c3039]"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-[#23272a] dark:text-zinc-400">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{entry.name}</span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        v{entry.version}
                      </span>
                      {entry.state === 'update' && (
                        <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                          可更新
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {entry.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={locked || entry.builtin}
                    className={PRIMARY}
                    onClick={(event) => {
                      event.stopPropagation();
                      void (entry.state === 'update'
                        ? update(entry)
                        : install(entry));
                    }}
                  >
                    {entry.builtin
                      ? '内置'
                      : entry.state === 'update'
                        ? '更新'
                        : '安装'}
                  </button>
                </div>
              </div>
            );
          })}
          {state.available.length === 0 && (
            <p className="px-1 text-[11px] text-zinc-400">目录为空</p>
          )}
        </div>
      </section>

      {error && <p className="px-1 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
