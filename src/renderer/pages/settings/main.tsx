/**
 * 单页设置：所有设置项合并成可收起的 card；默认全部收起。
 * 卡片内容直接是 React + next domain，不再内嵌页面。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { openListItem, useLists } from '../../shared/domains/lists.ts';
import { notifyError } from '../../shared/domains/notices.ts';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  ChevronRight,
  Cpu,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  MessagesSquare,
  Package,
  Palette,
  Puzzle,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { DomainUpdate } from '../../../main/runtime/shared.ts';
import '../../shared/styles/index.css';

interface SettingsPage {
  id: string;
  label: string;
  desc: string;
  icon: string;
  internal?: boolean;
}

interface WorkspaceMeta {
  id: string;
  path: string;
  name: string;
  exists: boolean;
}

interface AppearanceSnapshot {
  theme: 'light' | 'dark' | 'system';
  zoom: number;
  effectiveTheme: 'light' | 'dark';
}

interface StorageView {
  dataRoot: string;
  appPath: string;
  workspacePath: string;
  workspaceId: string;
  sceneFile: string;
  sessionsDir: string;
  versions: { app: string; electron: string; chrome: string; node: string };
}

interface SkillView {
  name: string;
  description: string;
  pluginName: string;
  pluginId?: string;
  scope: string;
  enabled?: boolean;
}

interface PluginView {
  id: string;
  name: string;
  version: string;
  hasConfig: boolean;
}

interface InstalledPlugin {
  source: string;
  type: string;
  label?: string;
  name?: string;
  version?: string;
}

interface PluginTask {
  id: string;
  source: string;
  label: string;
  status: string;
  phase: string;
  received: number;
  total: number | null;
  message: string;
  error: string | null;
}

interface ModelConfig {
  id: string;
  name?: string;
}

interface BindingView {
  transport: string;
  mime: string;
  codec?: string;
  presenter?: string;
}

interface SessionItem {
  path: string;
  name: string;
  preview?: string;
  createdAt: number;
}

interface ModelView {
  provider: string;
  modelId: string;
  label: string;
  available?: boolean;
}

interface ProviderView {
  id: string;
  name: string;
  configured: boolean;
  builtin: boolean;
  canApiKeyLogin: boolean;
  canOAuthLogin: boolean;
  authLabel?: string;
  modelCount: number;
}

interface ModelsView {
  providers: ProviderView[];
  catalog: ModelView[];
  config?: {
    providers: Record<
      string,
      { baseUrl?: string; name?: string; models?: ModelConfig[] }
    >;
  };
}

interface AgentSnapshot {
  sessionFile: string | null;
  provider?: string;
  modelId?: string;
  modelName?: string;
  isStreaming?: boolean;
}

interface ResourcePage {
  id: string;
  ref: string;
  surface: string;
}

interface ResourceState {
  workspaceId: string | null;
  ready: boolean;
  pages: ResourcePage[];
}

interface ResourceInfo {
  transports?: unknown[];
  codecs?: unknown[];
  presenters?: unknown[];
  diagnostics?: unknown[];
}

interface PreferencesView {
  theme: 'light' | 'dark';
  locale: string | null;
  proxy: string | null;
  githubToken: string | null;
}

interface AdvancedView {
  settings: {
    global: Record<string, unknown>;
    project: Record<string, unknown>;
    effective: Record<string, unknown>;
    paths: { global: string; project: string };
  } | null;
  bindings: BindingView[];
}

interface ExtensionView {
  source: string;
  scope: 'user' | 'project';
  installedPath?: string;
}

interface CatalogPackage {
  name: string;
  description?: string;
  type?: string;
  version?: string;
}

interface UpdateView {
  phase: string;
  current: string;
  latest: string | null;
  received: number;
  total: number;
  file: string | null;
  message: string | null;
}

const ICONS: Record<string, LucideIcon> = {
  palette: Palette,
  sliders: SlidersHorizontal,
  globe: Globe,
  package: Package,
  download: Download,
  'hard-drive': HardDrive,
  cpu: Cpu,
  puzzle: Puzzle,
  book: BookOpen,
  messages: MessagesSquare,
  folder: FolderOpen,
  'folder-tree': FolderOpen,
};

function useResource<T>(domain: string, resource: string, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const bridge = window.workStudio;
    if (!bridge) return;
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot') setValue(update.data as T);
      else if (update.type === 'patch') {
        setValue((current) => ({ ...current, ...update.data }) as T);
      }
    });
    void bridge.subscribe(domain, resource).then((data) => setValue(data as T));
    return () => {
      off();
      bridge.unsubscribe(domain, resource);
    };
  }, [domain, resource]);
  return value;
}

async function run<T>(
  domain: string,
  resource: string,
  action: string,
  input?: unknown,
): Promise<T> {
  const result = await window.workStudio.command<T>(
    domain,
    resource,
    action,
    input,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function Row({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="flex gap-3 px-1 py-1.5 text-[12px]">
      <span className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 break-all text-zinc-700 dark:text-zinc-200 ${
          monospace ? 'font-mono' : ''
        }`}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="space-y-3 p-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-[#2c3039]">
      <h3 className="mb-2 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-[#4F6BED] bg-[#4F6BED]/10 text-[#4F6BED] dark:text-[#8ea3f5]'
          : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-[#303436] dark:text-zinc-300 dark:hover:bg-[#23272a]'
      }`}
    >
      {children}
    </button>
  );
}

function AppearanceCard() {
  const appearance = useResource<AppearanceSnapshot>('settings', 'appearance', {
    theme: 'system',
    zoom: 100,
    effectiveTheme: 'light',
  });
  const update = (patch: Partial<AppearanceSnapshot>): void => {
    void run('settings', 'appearance', 'set', patch);
  };
  const themes = [
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
    { id: 'system', label: '跟随系统' },
  ] as const;
  return (
    <Panel>
      <Section title="主题">
        <div className="flex gap-2">
          {themes.map((item) => (
            <Button
              key={item.id}
              active={appearance.theme === item.id}
              onClick={() => update({ theme: item.id })}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          当前有效主题：{appearance.effectiveTheme === 'dark' ? '深色' : '浅色'}
        </p>
      </Section>
      <Section title="界面缩放">
        <div className="flex items-center gap-3">
          <select
            value={appearance.zoom}
            onChange={(event) => update({ zoom: Number(event.target.value) })}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          >
            {[75, 80, 90, 100, 110, 125, 150].map((zoom) => (
              <option key={zoom} value={zoom}>
                {zoom}%
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            对文档 / 网页内容页生效
          </span>
        </div>
      </Section>
    </Panel>
  );
}

function StorageCard() {
  const storage = useResource<StorageView>('settings', 'storage', {
    dataRoot: '',
    appPath: '',
    workspacePath: '',
    workspaceId: '',
    sceneFile: '',
    sessionsDir: '',
    versions: { app: '', electron: '', chrome: '', node: '' },
  });
  return (
    <Panel>
      <Section title="位置">
        <Row label="数据根" value={storage.dataRoot} monospace />
        <div className="flex justify-end gap-2 px-1 pb-2">
          <Button
            onClick={() =>
              void run('settings', 'storage', 'open', {
                path: storage.dataRoot,
              })
            }
          >
            打开数据根
          </Button>
          <Button
            onClick={() =>
              void run('settings', 'storage', 'open', {
                path: storage.sessionsDir,
              })
            }
          >
            打开会话目录
          </Button>
          <Button
            onClick={() => {
              void run<string | null>('settings', 'storage', 'changeRoot').then(
                (path) => {
                  if (path) {
                    window.alert('数据根已更新，重启应用后生效。');
                  }
                },
              );
            }}
          >
            更改数据根…
          </Button>
          <Button
            onClick={() => {
              void run<string | null>(
                'settings',
                'storage',
                'changeSessionDir',
              );
            }}
          >
            更改会话目录…
          </Button>
        </div>
        <Row label="工作区" value={storage.workspacePath} monospace />
        <div className="flex justify-end px-1 pb-2">
          <Button
            onClick={() =>
              void run('settings', 'storage', 'open', {
                path: storage.workspacePath,
              })
            }
          >
            打开工作区
          </Button>
        </div>
        <Row label="工作区 ID" value={storage.workspaceId} monospace />
        <Row label="场景文件" value={storage.sceneFile} monospace />
        <Row label="会话目录" value={storage.sessionsDir} monospace />
        <Row label="应用目录" value={storage.appPath} monospace />
      </Section>
      <Section title="版本">
        <Row label="WorkStudio" value={storage.versions.app} />
        <Row label="Electron" value={storage.versions.electron} />
        <Row label="Chromium" value={storage.versions.chrome} />
        <Row label="Node" value={storage.versions.node} />
      </Section>
    </Panel>
  );
}

function WorkspacesCard() {
  const list = useResource<WorkspaceMeta[]>('workspaces', 'list', []);
  const current = useResource<WorkspaceMeta | null>(
    'workspaces',
    'current',
    null,
  );
  const openDirectory = async (): Promise<void> => {
    const path = await run<string | null>(
      'shell',
      'native',
      'pickDirectory',
      {},
    );
    if (path) await run('workspaces', 'list', 'open', { path });
  };
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          窗口与工作区一一对应。
        </p>
        <Button onClick={() => void openDirectory()}>打开目录…</Button>
      </div>
      <div className="space-y-1">
        {list.map((workspace) => (
          <div
            key={workspace.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-[#2c3039]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12px] font-medium">
                {workspace.name}
                {workspace.id === current?.id && (
                  <span className="rounded bg-[#4F6BED]/10 px-1.5 py-0.5 text-[10px] text-[#4F6BED]">
                    当前
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                {workspace.path}
              </div>
            </div>
            <Button
              disabled={workspace.id === current?.id}
              onClick={() =>
                void run('workspaces', 'list', 'open', { path: workspace.path })
              }
            >
              切换
            </Button>
            <Button
              onClick={() =>
                void run('shell', 'native', 'openPath', {
                  path: workspace.path,
                })
              }
            >
              打开目录
            </Button>
            <Button
              onClick={() => {
                const name = window.prompt('重命名工作区', workspace.name);
                if (name?.trim()) {
                  void run('workspaces', 'list', 'rename', {
                    id: workspace.id,
                    name: name.trim(),
                  });
                }
              }}
            >
              重命名
            </Button>
            <Button
              disabled={workspace.id === current?.id}
              onClick={() => {
                if (!window.confirm(`移除工作区「${workspace.name}」？`))
                  return;
                void run('workspaces', 'list', 'remove', { id: workspace.id });
              }}
            >
              移除
            </Button>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-[12px] text-zinc-500">暂无工作区</p>
        )}
      </div>
    </Panel>
  );
}

function PluginsCard() {
  const plugins = useResource<PluginView[]>('plugins', 'list', []);
  const installed = useResource<InstalledPlugin[]>('plugins', 'installed', []);
  const task = useResource<PluginTask | null>('plugins', 'task', null);
  const [source, setSource] = useState('');
  const [catalog, setCatalog] = useState<
    Array<{ id?: string; name?: string; source?: string; description?: string }>
  >([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<void>): Promise<void> => {
    try {
      setError('');
      setBusy(true);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      {task && (
        <Section title="安装任务">
          <div className="text-[12px]">
            <div className="font-medium">{task.label}</div>
            <div className="text-[11px] text-zinc-500">
              {task.status} · {task.phase}
              {task.total ? ` · ${task.received}/${task.total}` : ''}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">{task.message}</div>
            {task.error && (
              <div className="mt-1 text-[11px] text-red-500">{task.error}</div>
            )}
            <div className="mt-2 flex justify-end gap-2">
              {task.status === 'running' && (
                <Button
                  onClick={() =>
                    void run('plugins', 'task', 'cancel').then(() => undefined)
                  }
                >
                  取消
                </Button>
              )}
              {(task.status === 'failed' || task.status === 'cancelled') && (
                <Button onClick={() => void run('plugins', 'task', 'retry')}>
                  重试
                </Button>
              )}
            </div>
          </div>
        </Section>
      )}
      <Section title="安装插件">
        <div className="flex gap-2">
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="zip 地址、本地 zip 或目录"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button
            disabled={busy || !source.trim()}
            onClick={() =>
              void act(async () => {
                await run('plugins', 'list', 'install', { source });
                setSource('');
              })
            }
          >
            安装
          </Button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
      </Section>
      <Section title="插件目录">
        <div className="flex justify-end">
          <Button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const result =
                  (await run<{
                    entries?: Array<{
                      id?: string;
                      name?: string;
                      source?: string;
                      description?: string;
                    }>;
                  }>('plugins', 'list', 'catalog')) ?? {};
                setCatalog(result.entries ?? []);
              })
            }
          >
            刷新目录
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {catalog.map((item, index) => (
            <div
              key={`${item.id ?? index}`}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {item.name ?? item.id ?? item.source}
                </div>
                <div className="truncate text-zinc-400">
                  {item.description ?? item.source}
                </div>
              </div>
              {item.source && (
                <Button
                  onClick={() =>
                    void act(() =>
                      run('plugins', 'list', 'install', {
                        source: item.source,
                      }),
                    )
                  }
                >
                  安装
                </Button>
              )}
            </div>
          ))}
          {catalog.length === 0 && (
            <p className="text-[12px] text-zinc-500">目录尚未加载</p>
          )}
        </div>
      </Section>
      <Section title="已安装来源">
        <div className="space-y-1">
          {installed.map((item) => (
            <div
              key={item.source}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  {item.label ?? item.name ?? item.source}
                </div>
                <div className="truncate font-mono text-[10px] text-zinc-400">
                  {item.source}
                </div>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    run('plugins', 'list', 'reload', {
                      source: item.source,
                    }),
                  )
                }
              >
                重载
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    run('plugins', 'list', 'remove', {
                      source: item.source,
                    }),
                  )
                }
              >
                卸载
              </Button>
            </div>
          ))}
          {installed.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无已安装来源</p>
          )}
        </div>
      </Section>
      <Section title="运行时插件">
        <div className="space-y-1">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium">{plugin.name}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  v{plugin.version} · {plugin.hasConfig ? '可配置' : '仅查看器'}
                </div>
              </div>
              <Button
                disabled={!plugin.hasConfig}
                onClick={() =>
                  void run('plugins', 'list', 'open', {
                    pluginId: plugin.id,
                    surface: 'settings',
                  })
                }
              >
                配置
              </Button>
            </div>
          ))}
        </div>
      </Section>
    </Panel>
  );
}

function SessionsCard() {
  const sessions = useResource<SessionItem[]>('sessions', 'list', []);
  const current = useResource<AgentSnapshot | null>(
    'sessions',
    'current',
    null,
  );
  return (
    <Panel>
      <div className="flex justify-end gap-2">
        {current?.isStreaming && (
          <Button onClick={() => void run('sessions', 'current', 'abort')}>
            停止当前任务
          </Button>
        )}
        <Button onClick={() => void run('sessions', 'current', 'new')}>
          新建会话
        </Button>
      </div>
      <div className="space-y-1">
        {sessions.map((session) => (
          <div
            key={session.path}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-[#2c3039]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">
                {session.name}
              </div>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {session.preview ?? session.path}
              </div>
            </div>
            <Button
              disabled={current?.sessionFile === session.path}
              onClick={() =>
                void run('sessions', 'current', 'open', {
                  sessionId: encodeURIComponent(session.path),
                })
              }
            >
              打开
            </Button>
            <Button
              onClick={() => {
                const name = window.prompt('重命名会话', session.name);
                if (name?.trim()) {
                  void run('sessions', 'current', 'rename', {
                    name: name.trim(),
                    path: session.path,
                  });
                }
              }}
            >
              重命名
            </Button>
            <Button
              disabled={current?.isStreaming}
              onClick={() => {
                if (!window.confirm(`删除会话「${session.name}」？`)) return;
                void run('sessions', 'current', 'delete', {
                  path: session.path,
                });
              }}
            >
              删除
            </Button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-[12px] text-zinc-500">暂无会话</p>
        )}
      </div>
    </Panel>
  );
}

function ModelsCard() {
  const models = useResource<ModelsView>('models', 'config', {
    providers: [],
    catalog: [],
    config: { providers: {} },
  });
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const current = useResource<AgentSnapshot | null>(
    'sessions',
    'current',
    null,
  );
  const login = async (provider: ProviderView): Promise<void> => {
    if (provider.canApiKeyLogin) {
      const apiKey = window.prompt(`输入 ${provider.name} 的 API Key`);
      if (!apiKey) return;
      await run('models', 'config', 'login', {
        providerId: provider.id,
        type: 'api_key',
        apiKey,
      });
    } else if (provider.canOAuthLogin) {
      await run('models', 'config', 'login', {
        providerId: provider.id,
        type: 'oauth',
      });
    }
  };
  return (
    <Panel>
      <Section title="新增 / 更新自定义供应商">
        <div className="flex gap-2">
          <input
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            placeholder="provider id（小写）"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            className="min-w-0 flex-[2] rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button
            disabled={!providerId.trim() || !baseUrl.trim()}
            onClick={() =>
              void run('models', 'config', 'saveProvider', {
                providerId: providerId.trim(),
                config: { baseUrl: baseUrl.trim() },
              }).then(() => {
                setProviderId('');
                setBaseUrl('');
              })
            }
          >
            保存
          </Button>
        </div>
      </Section>
      <Section title="新增 / 更新模型">
        <div className="flex gap-2">
          <input
            value={modelProvider}
            onChange={(event) => setModelProvider(event.target.value)}
            placeholder="provider id"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="model id"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
            placeholder="展示名"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button
            disabled={!modelProvider.trim() || !modelId.trim()}
            onClick={() =>
              void run('models', 'config', 'saveModel', {
                providerId: modelProvider.trim(),
                model: {
                  id: modelId.trim(),
                  name: modelName.trim() || undefined,
                },
              }).then(() => {
                setModelId('');
                setModelName('');
              })
            }
          >
            保存
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {Object.entries(models.config?.providers ?? {}).flatMap(
            ([provider, config]) =>
              (config.models ?? []).map((model) => (
                <div
                  key={`${provider}/${model.id}`}
                  className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
                >
                  <span className="min-w-0 flex-1 font-mono">
                    {provider}/{model.id}
                  </span>
                  <Button
                    onClick={() =>
                      void run('models', 'config', 'deleteModel', {
                        providerId: provider,
                        modelId: model.id,
                      })
                    }
                  >
                    删除
                  </Button>
                </div>
              )),
          )}
        </div>
      </Section>
      <Section title="供应商">
        <div className="space-y-1">
          {models.providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[12px] dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{provider.name}</div>
                <div className="truncate text-[10px] text-zinc-400">
                  {provider.configured
                    ? `已连接 · ${provider.authLabel ?? ''}`
                    : '未连接'}
                  {' · '}
                  {provider.modelCount} 个模型
                </div>
              </div>
              {!provider.builtin && (
                <Button
                  onClick={() =>
                    void run('models', 'config', 'deleteProvider', {
                      providerId: provider.id,
                    })
                  }
                >
                  删除
                </Button>
              )}
              {provider.configured ? (
                <Button
                  onClick={() =>
                    void run('models', 'config', 'logout', {
                      providerId: provider.id,
                    })
                  }
                >
                  退出
                </Button>
              ) : (
                <Button
                  disabled={!provider.canApiKeyLogin && !provider.canOAuthLogin}
                  onClick={() => void login(provider)}
                >
                  {provider.canOAuthLogin ? 'OAuth 登录' : '填写 Key'}
                </Button>
              )}
            </div>
          ))}
          {models.providers.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无供应商目录</p>
          )}
        </div>
      </Section>
      <Section title="可用模型">
        <div className="space-y-1">
          {models.catalog
            .filter((model) => model.available !== false)
            .map((model) => {
              const active =
                current?.provider === model.provider &&
                current?.modelId === model.modelId;
              return (
                <div
                  key={`${model.provider}/${model.modelId}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-[#2c3039]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium">{model.label}</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {model.provider} · {model.modelId}
                    </div>
                  </div>
                  <Button
                    active={active}
                    disabled={active}
                    onClick={() =>
                      void run('sessions', 'current', 'setModel', {
                        provider: model.provider,
                        modelId: model.modelId,
                      })
                    }
                  >
                    {active ? '当前' : '使用'}
                  </Button>
                </div>
              );
            })}
          {models.catalog.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无可用模型</p>
          )}
        </div>
      </Section>
    </Panel>
  );
}

function SkillsCard() {
  const skills = useResource<SkillView[]>('skills', 'catalog', []);
  const [diagnostics, setDiagnostics] = useState<
    Array<{ type: string; message: string; path?: string }>
  >([]);
  return (
    <Panel>
      <div className="mb-2 flex justify-end gap-2">
        <Button
          onClick={() =>
            void run<Array<{ type: string; message: string; path?: string }>>(
              'skills',
              'catalog',
              'diagnostics',
            ).then(setDiagnostics)
          }
        >
          诊断
        </Button>
        <Button onClick={() => void run('skills', 'catalog', 'reload')}>
          重新装载
        </Button>
      </div>
      {diagnostics.length > 0 && (
        <Section title="装载诊断">
          {diagnostics.map((item, index) => (
            <div key={index} className="text-[11px] text-amber-600">
              {item.type}: {item.message}
            </div>
          ))}
        </Section>
      )}
      <div className="space-y-1">
        {skills.map((skill) => (
          <div
            key={skill.name}
            className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-[#2c3039]"
          >
            <div className="flex items-center gap-2 text-[12px] font-medium">
              {skill.name}
              {skill.enabled === false && (
                <span className="text-[10px] text-zinc-400">已停用</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {skill.description}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-400">
                {skill.pluginName} · {skill.scope}
              </span>
              <div className="flex gap-1">
                {skill.pluginId && skill.pluginId !== 'builtin' && (
                  <Button
                    onClick={() =>
                      void run('skills', 'catalog', 'openPlugin', {
                        pluginId: skill.pluginId,
                      })
                    }
                  >
                    插件
                  </Button>
                )}
                <Button
                  onClick={() =>
                    void run('skills', 'catalog', 'setEnabled', {
                      name: skill.name,
                      enabled: skill.enabled === false,
                    })
                  }
                >
                  {skill.enabled === false ? '启用' : '停用'}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {skills.length === 0 && (
          <p className="text-[12px] text-zinc-500">暂无已加载技能</p>
        )}
      </div>
    </Panel>
  );
}

function BrowserCard() {
  const policy = useResource<{ allowlist: string[] }>('settings', 'browser', {
    allowlist: [],
  });
  const lists = useLists();
  const sites = lists.filter((group) => group.definitionId === 'web');
  const [domain, setDomain] = useState('');
  const save = async (allowlist: string[]): Promise<void> => {
    await run('settings', 'browser', 'set', { allowlist });
  };
  return (
    <Panel>
      <Section title="归档白名单">
        <div className="flex gap-2">
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="example.com"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button
            disabled={!domain.trim()}
            onClick={() => {
              void save([...policy.allowlist, domain.trim()]).then(() =>
                setDomain(''),
              );
            }}
          >
            添加域名
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {policy.allowlist.map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <span className="min-w-0 flex-1 font-mono">{item}</span>
              <Button
                onClick={() =>
                  void save(policy.allowlist.filter((value) => value !== item))
                }
              >
                移除
              </Button>
            </div>
          ))}
          {policy.allowlist.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无白名单域名</p>
          )}
        </div>
      </Section>
      <Section title="站点资料">
        <div className="space-y-2">
          {sites.map((group) => (
            <div key={group.id}>
              <div className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                {group.label} · {group.countLabel}
              </div>
              <div className="space-y-1">
                {group.items.slice(0, 20).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      void openListItem(item).catch((error: unknown) =>
                        notifyError(
                          error instanceof Error
                            ? error.message
                            : String(error),
                          'browser',
                        ),
                      )
                    }
                    className="flex w-full items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-left text-[11px] hover:border-[#4F6BED]/60 dark:border-[#2c3039]"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">
                      {String(item.meta?.['url'] ?? '')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {sites.length === 0 && (
            <p className="text-[12px] text-zinc-500">
              暂无站点资料；浏览器采集后会出现在这里。
            </p>
          )}
        </div>
      </Section>
    </Panel>
  );
}

function ResourcesCard() {
  const workspace = useResource<WorkspaceMeta | null>(
    'workspaces',
    'current',
    null,
  );
  const scope = workspace?.id ? `ws:${workspace.id}` : 'current';
  const state = useResource<ResourceState>('resources', scope, {
    workspaceId: null,
    ready: false,
    pages: [],
  });
  const info = useResource<ResourceInfo>('settings', 'resourceInfo', {});
  return (
    <Panel>
      <div className="mb-2 flex justify-end">
        <Button onClick={() => void run('resources', scope, 'refresh')}>
          刷新
        </Button>
      </div>
      <Row label="工作区 ID" value={state.workspaceId ?? ''} monospace />
      <Row label="资源引擎" value={state.ready ? '已就绪' : '启动中'} />
      <Row
        label="来源 / 格式"
        value={`${info.transports?.length ?? 0} / ${info.codecs?.length ?? 0}`}
      />
      <Row label="表现层" value={`${info.presenters?.length ?? 0}`} />
      <Section title={`已打开页面（${state.pages.length}）`}>
        <div className="space-y-1">
          {state.pages.map((page) => (
            <div
              key={page.id}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <span className="min-w-0 flex-1 break-all font-mono text-zinc-600 dark:text-zinc-300">
                {page.ref}
              </span>
              <span className="shrink-0 text-zinc-400">{page.surface}</span>
              <Button
                onClick={() =>
                  void run('resources', scope, 'closePage', {
                    pageId: page.id,
                  })
                }
              >
                关闭
              </Button>
            </div>
          ))}
          {state.pages.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无页面会话</p>
          )}
        </div>
      </Section>
    </Panel>
  );
}

function PreferencesCard() {
  const preferences = useResource<PreferencesView>('settings', 'preferences', {
    theme: 'dark',
    locale: null,
    proxy: null,
    githubToken: null,
  });
  const advanced = useResource<AdvancedView>('settings', 'advanced', {
    settings: null,
    bindings: [],
  });
  const [locale, setLocale] = useState('');
  const [proxy, setProxy] = useState('');
  const [globalText, setGlobalText] = useState('');
  const [projectText, setProjectText] = useState('');
  const [bindingTransport, setBindingTransport] = useState('file');
  const [bindingMime, setBindingMime] = useState('');
  const [bindingCodec, setBindingCodec] = useState('');
  const [bindingPresenter, setBindingPresenter] = useState('');
  useEffect(() => {
    if (!advanced.settings) return;
    setGlobalText(JSON.stringify(advanced.settings.global, null, 2));
    setProjectText(JSON.stringify(advanced.settings.project, null, 2));
  }, [advanced.settings]);
  const saveAdvanced = async (scope: 'global' | 'project'): Promise<void> => {
    try {
      const value = JSON.parse(
        scope === 'global' ? globalText : projectText,
      ) as Record<string, unknown>;
      await run('settings', 'advanced', 'replace', { scope, value });
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    setLocale(preferences.locale ?? '');
    setProxy(preferences.proxy ?? '');
  }, [preferences]);
  return (
    <Panel>
      <Section title="应用默认">
        <div className="mt-2 flex items-center gap-2 text-[12px]">
          语言
          <input
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            placeholder="跟随系统"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12px]">
          代理
          <input
            value={proxy}
            onChange={(event) => setProxy(event.target.value)}
            placeholder="http://127.0.0.1:7890"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() =>
              void run('settings', 'preferences', 'set', {
                locale: locale.trim() || null,
                proxy: proxy.trim() || null,
              })
            }
          >
            保存
          </Button>
        </div>
      </Section>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
        技能开关请使用「技能」卡片。
      </p>
      <Section title="URA 绑定">
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={bindingTransport}
            onChange={(event) => setBindingTransport(event.target.value)}
            placeholder="transport"
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={bindingMime}
            onChange={(event) => setBindingMime(event.target.value)}
            placeholder="mime"
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={bindingCodec}
            onChange={(event) => setBindingCodec(event.target.value)}
            placeholder="codec（可选）"
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <input
            value={bindingPresenter}
            onChange={(event) => setBindingPresenter(event.target.value)}
            placeholder="presenter（可选）"
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            disabled={!bindingTransport.trim() || !bindingMime.trim()}
            onClick={() =>
              void run('settings', 'advanced', 'setBinding', {
                binding: {
                  transport: bindingTransport.trim(),
                  mime: bindingMime.trim(),
                  ...(bindingCodec.trim()
                    ? { codec: bindingCodec.trim() }
                    : {}),
                  ...(bindingPresenter.trim()
                    ? { presenter: bindingPresenter.trim() }
                    : {}),
                },
              }).then(() => setBindingMime(''))
            }
          >
            写入绑定
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {advanced.bindings.map((binding) => (
            <div
              key={`${binding.transport}:${binding.mime}`}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <span className="min-w-0 flex-1 font-mono">
                {binding.transport} × {binding.mime}
                {binding.codec ? ` → ${binding.codec}` : ''}
                {binding.presenter ? ` → ${binding.presenter}` : ''}
              </span>
              <Button
                onClick={() =>
                  void run('settings', 'advanced', 'removeBinding', {
                    transport: binding.transport,
                    mime: binding.mime,
                  })
                }
              >
                删除
              </Button>
            </div>
          ))}
          {advanced.bindings.length === 0 && (
            <p className="text-[11px] text-zinc-500">暂无用户绑定</p>
          )}
        </div>
      </Section>
      <Section title="高级设置（piconf）">
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          App 默认与工作区覆盖直接编辑 JSON；未知字段原样保留。
        </p>
        <label className="text-[11px] text-zinc-500">App 默认</label>
        <textarea
          value={globalText}
          onChange={(event) => setGlobalText(event.target.value)}
          spellCheck={false}
          className="mt-1 h-32 w-full resize-y rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] outline-none dark:border-[#303436] dark:bg-[#1c1e1f]"
        />
        <div className="mt-1 flex justify-end">
          <Button onClick={() => void saveAdvanced('global')}>
            保存 App 默认
          </Button>
        </div>
        <label className="mt-3 block text-[11px] text-zinc-500">
          本工作区覆盖
        </label>
        <textarea
          value={projectText}
          onChange={(event) => setProjectText(event.target.value)}
          spellCheck={false}
          className="mt-1 h-32 w-full resize-y rounded-md border border-zinc-200 bg-white p-2 font-mono text-[11px] outline-none dark:border-[#303436] dark:bg-[#1c1e1f]"
        />
        <div className="mt-1 flex justify-end">
          <Button onClick={() => void saveAdvanced('project')}>
            保存本工作区
          </Button>
        </div>
        {advanced.settings && (
          <p className="mt-2 break-all font-mono text-[10px] text-zinc-400">
            {advanced.settings.paths.global}
            {' / '}
            {advanced.settings.paths.project}
          </p>
        )}
      </Section>
    </Panel>
  );
}

function ExtensionsCard() {
  const extensions = useResource<ExtensionView[]>('settings', 'extensions', []);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<CatalogPackage[]>([]);
  const [error, setError] = useState('');
  const install = async (target = name): Promise<void> => {
    try {
      setError('');
      await run('settings', 'extensions', 'install', { name: target });
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const search = async (): Promise<void> => {
    try {
      setError('');
      const result =
        (await run<{ packages?: CatalogPackage[] }>(
          'settings',
          'extensions',
          'catalog',
          { query, page: 1 },
        )) ?? {};
      setCatalog(result.packages ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Panel>
      <Section title="社区目录">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索扩展"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button onClick={() => void search()}>搜索</Button>
        </div>
        {catalog.length > 0 && (
          <div className="mt-2 space-y-1">
            {catalog.slice(0, 20).map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="truncate text-zinc-400">
                    {item.description ?? ''}
                  </div>
                </div>
                <Button onClick={() => void install(item.name)}>安装</Button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="安装 npm 包">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="npm 包名"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button disabled={!name.trim()} onClick={() => void install()}>
            安装
          </Button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
      </Section>
      <Section title="已安装">
        <div className="space-y-1">
          {extensions.map((extension) => (
            <div
              key={`${extension.source}:${extension.scope}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-[12px] dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono">{extension.source}</div>
                <div className="text-[11px] text-zinc-500">
                  {extension.scope}
                </div>
              </div>
              <Button
                onClick={() =>
                  void run('settings', 'extensions', 'remove', {
                    source: extension.source,
                    scope: extension.scope,
                  })
                }
              >
                卸载
              </Button>
            </div>
          ))}
          {extensions.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无已安装扩展</p>
          )}
        </div>
      </Section>
    </Panel>
  );
}

function UpdatesCard() {
  const status = useResource<UpdateView>('settings', 'updates', {
    phase: 'idle',
    current: '',
    latest: null,
    received: 0,
    total: 0,
    file: null,
    message: null,
  });
  const preferences = useResource<PreferencesView>('settings', 'preferences', {
    theme: 'dark',
    locale: null,
    proxy: null,
    githubToken: null,
  });
  const [token, setToken] = useState('');
  useEffect(() => setToken(preferences.githubToken ?? ''), [preferences]);
  const progress =
    status.total > 0
      ? `${Math.round((status.received / status.total) * 100)}%`
      : '';
  return (
    <Panel>
      <Row label="当前版本" value={status.current} />
      <Row label="最新版本" value={status.latest ?? ''} />
      <Row
        label="状态"
        value={`${status.phase}${progress ? ` · ${progress}` : ''}`}
      />
      {status.message && (
        <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
          {status.message}
        </p>
      )}
      {status.file && <Row label="安装包" value={status.file} monospace />}
      <div className="flex items-center gap-2 text-[12px]">
        GitHub Token
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="ghp_…"
          className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
        />
        <Button
          onClick={() =>
            void run('settings', 'preferences', 'set', {
              githubToken: token.trim() || null,
            })
          }
        >
          保存 Token
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          disabled={status.phase === 'checking'}
          onClick={() => void run('settings', 'updates', 'check')}
        >
          检查更新
        </Button>
        <Button
          disabled={status.phase === 'downloading' || !status.latest}
          onClick={() => void run('settings', 'updates', 'download')}
        >
          下载安装包
        </Button>
        <Button
          disabled={!status.file}
          onClick={() => void run('settings', 'updates', 'open')}
        >
          打开安装包
        </Button>
        {status.phase === 'downloading' && (
          <Button onClick={() => void run('settings', 'updates', 'cancel')}>
            取消下载
          </Button>
        )}
      </div>
    </Panel>
  );
}

const CONTENT: Record<string, () => ReactNode> = {
  appearance: () => <AppearanceCard />,
  storage: () => <StorageCard />,
  workspaces: () => <WorkspacesCard />,
  plugins: () => <PluginsCard />,
  sessions: () => <SessionsCard />,
  models: () => <ModelsCard />,
  skills: () => <SkillsCard />,
  browser: () => <BrowserCard />,
  resources: () => <ResourcesCard />,
  updates: () => <UpdatesCard />,
  preferences: () => <PreferencesCard />,
  extensions: () => <ExtensionsCard />,
};

function useSettingsPages(): SettingsPage[] {
  const [pages, setPages] = useState<SettingsPage[]>([]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup: (() => void) | undefined;
    const bind = (): void => {
      if (disposed) return;
      const bridge = window.workStudio;
      if (!bridge) {
        timer = setTimeout(bind, 50);
        return;
      }
      const off = bridge.onUpdate((update: DomainUpdate) => {
        if (update.domain !== 'settings' || update.resource !== 'pages') return;
        if (update.type === 'snapshot') setPages(update.data as SettingsPage[]);
      });
      void bridge
        .subscribe('settings', 'pages')
        .then((value) => setPages((value as SettingsPage[]) ?? []));
      cleanup = () => {
        off();
        bridge.unsubscribe('settings', 'pages');
      };
    };
    bind();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      cleanup?.();
    };
  }, []);
  return pages;
}

function Card({
  page,
  open,
  onToggle,
}: {
  page: SettingsPage;
  open: boolean;
  onToggle: (next: boolean) => void;
}) {
  const Icon = ICONS[page.icon] ?? Settings;
  const content = CONTENT[page.id];
  return (
    <section
      data-testid="settings-card"
      data-page={page.id}
      data-open={open ? 'true' : 'false'}
      className="rounded-xl border border-zinc-200 bg-white dark:border-[#2c3039] dark:bg-[#141618]"
    >
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-[#222629] dark:text-zinc-300">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            {page.label}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-zinc-500 dark:text-zinc-400">
            {page.desc}
          </span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform dark:text-zinc-500 ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>
      {open && content && (
        <div className="border-t border-zinc-200 dark:border-[#2c3039]">
          {content()}
        </div>
      )}
    </section>
  );
}

/** 地址里的卡片：work://studio/settings/<card>。 */
function cardFromAddress(): string {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[0] === 'settings' && parts[1] ? parts[1] : '';
}

/** 卡片与地址一一对应：开一张卡 = 换一次地址；全收起 = /settings。 */
function applyCard(card: string): void {
  const path = card ? `/settings/${card}` : '/settings';
  try {
    history.replaceState(null, '', path);
  } catch {
    /* 非标准 scheme 时忽略，地址仍由主进程记录 */
  }
  void window.workStudio?.command('shell', 'session', 'locate', { card });
}

function SettingsHome() {
  const pages = useSettingsPages();
  const [openCard, setOpenCard] = useState(cardFromAddress);
  const visible = useMemo(
    () => pages.filter((page) => !page.internal),
    [pages],
  );

  // 从地址进入时展开对应卡片并滚到可见处。
  useEffect(() => {
    if (!openCard) return;
    const node = document.querySelector(`[data-page="${openCard}"]`);
    node?.scrollIntoView({ block: 'center' });
  }, [openCard, visible.length]);

  const toggle = (card: string, next: boolean): void => {
    const value = next ? card : '';
    setOpenCard(value);
    applyCard(value);
  };

  return (
    <div className="h-screen overflow-y-auto bg-zinc-100 text-zinc-900 dark:bg-[#1a1c1d] dark:text-zinc-100">
      <div className="mx-auto max-w-[980px] px-6 py-8">
        <h1 className="text-[18px] font-semibold">设置</h1>
        <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          所有设置项按卡片收纳，默认收起。
        </p>
        <div className="mt-6 space-y-3">
          {visible.map((page) => (
            <Card
              key={page.id}
              page={page}
              open={openCard === page.id}
              onToggle={(next) => toggle(page.id, next)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SettingsHome />);
