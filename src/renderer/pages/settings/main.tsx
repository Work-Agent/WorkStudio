/**
 * 单页设置：所有设置项合并成可收起的 card；默认全部收起。
 * 卡片内容直接是 React + next domain，不再内嵌页面。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { command } from '../../shared/api/bridge.ts';
import {
  openResourceNode,
  useResourceForest,
} from '../../shared/domains/resources.ts';
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
import type { DomainUpdate } from '@work-studio/sdk';
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

interface ModelConfig {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
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
    const apply = (current: T, data: unknown): T => {
      if (data === undefined) return current;
      if (data === null) return (initial === null ? null : current) as T;
      if (Array.isArray(data)) return data as T;
      if (
        typeof data === 'object' &&
        typeof current === 'object' &&
        current !== null
      ) {
        return { ...current, ...(data as Record<string, unknown>) } as T;
      }
      return data as T;
    };
    const off = bridge.onUpdate((update: DomainUpdate) => {
      if (update.domain !== domain || update.resource !== resource) return;
      if (update.type === 'snapshot') {
        setValue((current) => apply(current, update.data));
      } else if (update.type === 'patch') {
        setValue((current) => apply(current, update.data));
      }
    });
    void bridge
      .subscribe(domain, resource)
      .then((data) => setValue((current) => apply(current, data)));
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
  const state = useResource<{
    theme: 'light' | 'dark';
    source: 'light' | 'dark' | 'system';
    zoom: number;
  }>('shell', 'appearance', {
    theme: 'light',
    source: 'system',
    zoom: 1,
  });
  const appearance: AppearanceSnapshot = {
    theme: state.source,
    zoom: Math.round(state.zoom * 100),
    effectiveTheme: state.theme,
  };
  const update = (patch: { source?: string; zoom?: number }): void => {
    void run('shell', 'appearance', 'set', patch);
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
              onClick={() => update({ source: item.id })}
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
            onChange={(event) =>
              update({ zoom: Number(event.target.value) / 100 })
            }
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
  const storage = useResource<{
    dataRoot: string;
    workspacesRoot: string;
    workspacePath: string;
    workspaceId: string;
    sessionsDir: string;
    versions?: {
      app: string;
      electron: string;
      chrome: string;
      node: string;
    };
  }>('settings', 'storage', {
    dataRoot: '',
    workspacesRoot: '',
    workspacePath: '',
    workspaceId: '',
    sessionsDir: '',
  });
  return (
    <Panel>
      <Section title="位置">
        <Row label="数据根" value={storage.dataRoot} monospace />
        <div className="flex justify-end gap-2 px-1 pb-2">
          <Button
            onClick={() =>
              void run('shell', 'native', 'openPath', {
                path: storage.dataRoot,
              })
            }
          >
            打开数据根
          </Button>
          <Button
            onClick={() =>
              void run('shell', 'native', 'openPath', {
                path: storage.sessionsDir,
              })
            }
          >
            打开会话目录
          </Button>
          <Button
            onClick={() => {
              void run<string | null>('settings', 'storage', 'changeDataRoot')
                .then((path) => {
                  if (path) window.alert('数据根已更新，重启应用后生效。');
                })
                .catch((error: unknown) =>
                  window.alert(
                    error instanceof Error ? error.message : String(error),
                  ),
                );
            }}
          >
            更改数据根…
          </Button>
          <Button
            onClick={() => {
              void run<string | null>('settings', 'storage', 'changeSessionDir')
                .then((path) => {
                  if (path) window.alert('会话目录已更新，新会话生效。');
                })
                .catch((error: unknown) =>
                  window.alert(
                    error instanceof Error ? error.message : String(error),
                  ),
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
              void run('shell', 'native', 'openPath', {
                path: storage.workspacePath,
              })
            }
          >
            打开工作区
          </Button>
        </div>
        <Row label="工作区 ID" value={storage.workspaceId} monospace />
        <Row label="会话目录" value={storage.sessionsDir} monospace />
      </Section>
      <Section title="版本">
        <Row label="WorkStudio" value={storage.versions?.app ?? ''} />
        <Row label="Electron" value={storage.versions?.electron ?? ''} />
        <Row label="Chromium" value={storage.versions?.chrome ?? ''} />
        <Row label="Node" value={storage.versions?.node ?? ''} />
      </Section>
    </Panel>
  );
}

function WorkspacesCard() {
  const registry = useResource<{
    current?: WorkspaceMeta | null;
    workspaces?: WorkspaceMeta[];
  }>('workspace', 'registry', {});
  const list = registry.workspaces ?? [];
  const current = registry.current ?? null;
  const openDirectory = async (): Promise<void> => {
    const path = await run<string | null>(
      'shell',
      'native',
      'pickDirectory',
      {},
    );
    if (path) await run('workspace', 'registry', 'open', { path });
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
                void run('workspace', 'registry', 'open', {
                  path: workspace.path,
                })
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
                  void run('workspace', 'registry', 'rename', {
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
                void run('workspace', 'registry', 'remove', {
                  id: workspace.id,
                });
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

function sessionsResource(): string {
  const ws = window.workStudio?.workspaceId;
  return ws ? `${ws}/sessions` : 'sessions';
}

function SessionsCard() {
  const aggregate = useResource<{
    items?: SessionItem[];
    current?: AgentSnapshot | null;
  }>('agent', sessionsResource(), { items: [], current: null });
  const sessions = aggregate.items ?? [];
  const current = aggregate.current ?? null;
  return (
    <Panel>
      <div className="flex justify-end gap-2">
        {current?.isStreaming && (
          <Button
            onClick={() => void run('agent', sessionsResource(), 'abort')}
          >
            停止当前任务
          </Button>
        )}
        <Button onClick={() => void run('agent', sessionsResource(), 'new')}>
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
                void run('agent', sessionsResource(), 'open', {
                  id: session.path,
                })
              }
            >
              打开
            </Button>
            <Button
              onClick={() => {
                const name = window.prompt('重命名会话', session.name);
                if (name?.trim()) {
                  void run('agent', sessionsResource(), 'rename', {
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
                void run('agent', sessionsResource(), 'delete', {
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
  const providerList = useResource<ProviderView[]>('agent', 'providers', []);
  const catalog = useResource<ModelView[]>('agent', 'models', []);
  const configValue = useResource<{
    providers: Record<
      string,
      { baseUrl?: string; name?: string; models?: ModelConfig[] }
    >;
  }>('agent', 'modelsConfig', { providers: {} });
  const config = configValue ?? { providers: {} };
  const models: ModelsView = {
    providers: providerList,
    catalog,
    config,
  };
  const providerAddress = (id: string): string =>
    `provider/${encodeURIComponent(id)}`;
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelContext, setModelContext] = useState('');
  const [modelMaxTokens, setModelMaxTokens] = useState('');
  const [modelReasoning, setModelReasoning] = useState(false);
  const [modelInput, setModelInput] = useState<Array<'text' | 'image'>>([
    'text',
  ]);
  const [providerQuery, setProviderQuery] = useState('');
  const [authFor, setAuthFor] = useState<string | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const session = useResource<{ current?: AgentSnapshot | null }>(
    'agent',
    'sessions',
    { current: null },
  );
  const current = session.current ?? null;

  const report = (reason: unknown): void =>
    notifyError(
      reason instanceof Error ? reason.message : String(reason),
      'models',
    );
  const positiveNumber = (value: string): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const login = (provider: ProviderView, type: 'api_key' | 'oauth'): void => {
    if (type === 'api_key' && !apiKey.trim()) return;
    setBusy(provider.id);
    void run('agent', providerAddress(provider.id), 'login', {
      type,
      ...(type === 'api_key' ? { apiKey: apiKey.trim() } : {}),
    })
      .then(() => {
        setAuthFor(null);
        setKeyFor(null);
        setApiKey('');
      })
      .catch(report)
      .finally(() => setBusy(null));
  };

  const startLogin = (provider: ProviderView): void => {
    if (provider.canApiKeyLogin && provider.canOAuthLogin) {
      setAuthFor(provider.id);
      return;
    }
    if (provider.canApiKeyLogin) {
      setAuthFor(null);
      setKeyFor(provider.id);
      setApiKey('');
      return;
    }
    if (provider.canOAuthLogin) {
      setAuthFor(null);
      setKeyFor(null);
      login(provider, 'oauth');
    }
  };

  const inputClass =
    'min-w-0 rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-[#303436] dark:bg-[#1c1e1f]';

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
            disabled={!providerId.trim() || !baseUrl.trim() || busy !== null}
            onClick={() =>
              void run('agent', 'providers', 'save', {
                providerId: providerId.trim(),
                config: { baseUrl: baseUrl.trim() },
              })
                .then(() => {
                  setProviderId('');
                  setBaseUrl('');
                })
                .catch(report)
            }
          >
            保存
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {Object.entries(config.providers).map(([id, provider]) => (
            <div
              key={id}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {id}
                {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
              </span>
              <Button
                onClick={() => {
                  setProviderId(id);
                  setBaseUrl(provider.baseUrl ?? '');
                }}
              >
                编辑
              </Button>
              <Button
                onClick={() =>
                  void run('agent', 'providers', 'delete', {
                    providerId: id,
                  }).catch(report)
                }
              >
                删除
              </Button>
            </div>
          ))}
          {Object.keys(config.providers).length === 0 && (
            <p className="text-[11px] text-zinc-500">暂无自定义供应商</p>
          )}
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
              void run('agent', 'models', 'save', {
                providerId: modelProvider.trim(),
                modelId: modelId.trim(),
                config: {
                  name: modelName.trim() || undefined,
                  ...(positiveNumber(modelContext) !== undefined
                    ? { contextWindow: positiveNumber(modelContext) }
                    : {}),
                  ...(positiveNumber(modelMaxTokens) !== undefined
                    ? { maxTokens: positiveNumber(modelMaxTokens) }
                    : {}),
                  ...(modelReasoning ? { reasoning: true } : {}),
                  ...(modelInput.length > 0 ? { input: modelInput } : {}),
                },
              })
                .then(() => {
                  setModelId('');
                  setModelName('');
                  setModelContext('');
                  setModelMaxTokens('');
                  setModelReasoning(false);
                  setModelInput(['text']);
                })
                .catch(report)
            }
          >
            保存
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <input
            value={modelContext}
            onChange={(event) => setModelContext(event.target.value)}
            inputMode="numeric"
            placeholder="contextWindow"
            className={`${inputClass} w-32`}
          />
          <input
            value={modelMaxTokens}
            onChange={(event) => setModelMaxTokens(event.target.value)}
            inputMode="numeric"
            placeholder="maxTokens"
            className={`${inputClass} w-28`}
          />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={modelReasoning}
              onChange={(event) => setModelReasoning(event.target.checked)}
            />
            reasoning
          </label>
          {(['text', 'image'] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={modelInput.includes(kind)}
                onChange={(event) =>
                  setModelInput((current) =>
                    event.target.checked
                      ? [...new Set([...current, kind])]
                      : current.filter((item) => item !== kind),
                  )
                }
              />
              {kind}
            </label>
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {Object.entries(config.providers).flatMap(([provider, cfg]) =>
            (cfg.models ?? []).map((model) => (
              <div
                key={`${provider}/${model.id}`}
                className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
              >
                <span className="min-w-0 flex-1 truncate font-mono">
                  {provider}/{model.id}
                  {model.name ? ` · ${model.name}` : ''}
                </span>
                <Button
                  onClick={() => {
                    setModelProvider(provider);
                    setModelId(model.id);
                    setModelName(model.name ?? '');
                    setModelContext(
                      model.contextWindow ? String(model.contextWindow) : '',
                    );
                    setModelMaxTokens(
                      model.maxTokens ? String(model.maxTokens) : '',
                    );
                    setModelReasoning(model.reasoning === true);
                    setModelInput(model.input?.length ? model.input : ['text']);
                  }}
                >
                  编辑
                </Button>
                <Button
                  onClick={() =>
                    void run('agent', 'models', 'delete', {
                      providerId: provider,
                      modelId: model.id,
                    }).catch(report)
                  }
                >
                  删除
                </Button>
              </div>
            )),
          )}
          {Object.values(config.providers).every(
            (provider) => !provider.models?.length,
          ) && <p className="text-[11px] text-zinc-500">暂无自定义模型</p>}
        </div>
      </Section>

      <Section title="供应商">
        <input
          value={providerQuery}
          onChange={(event) => setProviderQuery(event.target.value)}
          placeholder="筛选供应商…"
          className={`${inputClass} mb-2 w-full text-[12px]`}
        />
        <div className="space-y-1">
          {models.providers
            .filter((provider) =>
              `${provider.id} ${provider.name}`
                .toLowerCase()
                .includes(providerQuery.trim().toLowerCase()),
            )
            .map((provider) => {
              const canLogin =
                provider.canApiKeyLogin || provider.canOAuthLogin;
              const choosing = authFor === provider.id;
              const enteringKey = keyFor === provider.id;
              return (
                <div
                  key={provider.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[12px] dark:border-[#2c3039]"
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
                  {enteringKey ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') login(provider, 'api_key');
                          if (event.key === 'Escape') {
                            setKeyFor(null);
                            setApiKey('');
                          }
                        }}
                        placeholder="API Key"
                        className={`${inputClass} w-40`}
                      />
                      <Button
                        disabled={!apiKey.trim() || busy !== null}
                        onClick={() => login(provider, 'api_key')}
                      >
                        保存
                      </Button>
                      <Button
                        onClick={() => {
                          setKeyFor(null);
                          setApiKey('');
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ) : choosing ? (
                    <div className="flex items-center gap-1">
                      {provider.canApiKeyLogin && (
                        <Button
                          onClick={() => {
                            setAuthFor(null);
                            setKeyFor(provider.id);
                            setApiKey('');
                          }}
                        >
                          API Key
                        </Button>
                      )}
                      {provider.canOAuthLogin && (
                        <Button
                          disabled={busy !== null}
                          onClick={() => login(provider, 'oauth')}
                        >
                          OAuth
                        </Button>
                      )}
                      <Button onClick={() => setAuthFor(null)}>取消</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      {!provider.builtin && (
                        <Button
                          onClick={() =>
                            void run('agent', 'providers', 'delete', {
                              providerId: provider.id,
                            }).catch(report)
                          }
                        >
                          删除
                        </Button>
                      )}
                      {provider.configured && (
                        <Button
                          onClick={() =>
                            void run(
                              'agent',
                              providerAddress(provider.id),
                              'logout',
                            ).catch(report)
                          }
                        >
                          退出
                        </Button>
                      )}
                      {canLogin && (
                        <Button
                          disabled={busy !== null}
                          onClick={() => startLogin(provider)}
                        >
                          {provider.configured ? '重新登录' : '连接'}
                        </Button>
                      )}
                      {!canLogin && !provider.configured && (
                        <span className="text-[10px] text-zinc-400">
                          仅使用环境变量
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
                      void run('agent', 'models', 'setDefault', {
                        providerId: model.provider,
                        modelId: model.modelId,
                      }).catch(report)
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
  const state = useResource<{
    catalog?: Array<{
      name: string;
      description: string;
      pluginId?: string;
      path?: string;
    }>;
    disabled?: string[];
  }>('agent', 'skills', { catalog: [], disabled: [] });
  const disabled = new Set(state.disabled ?? []);
  const skills: SkillView[] = (state.catalog ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description,
    pluginName: skill.pluginId ?? '内置',
    ...(skill.pluginId ? { pluginId: skill.pluginId } : {}),
    scope: '应用',
    enabled: !disabled.has(skill.name),
  }));
  const [diagnostics, setDiagnostics] = useState<
    Array<{ type: string; message: string; path?: string }>
  >([]);
  return (
    <Panel>
      <div className="mb-2 flex justify-end gap-2">
        <Button
          onClick={() =>
            void run<Array<{ type: string; message: string; path?: string }>>(
              'agent',
              'skills',
              'diagnostics',
            ).then(setDiagnostics)
          }
        >
          诊断
        </Button>
        <Button onClick={() => void run('agent', 'skills', 'reload')}>
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
                      void run('agent', 'skills', 'openPlugin', {
                        pluginId: skill.pluginId,
                      })
                    }
                  >
                    插件
                  </Button>
                )}
                <Button
                  onClick={() =>
                    void run('agent', 'skills', 'setEnabled', {
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

function flattenResourceNodes(
  nodes: import('@work-studio/sdk').ResourceNode[],
): import('@work-studio/sdk').ResourceNode[] {
  return nodes.flatMap((node) =>
    node.children?.length ? flattenResourceNodes(node.children) : [node],
  );
}

function BrowserCard() {
  const policy = useResource<{ allowlist: string[] }>('browser', 'policy', {
    allowlist: [],
  });
  const lists = useResourceForest();
  const sites = lists.filter((group) => group.definitionId === 'web');
  const [domain, setDomain] = useState('');
  const save = async (allowlist: string[]): Promise<void> => {
    await run('browser', 'policy', 'set', { allowlist });
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
                {flattenResourceNodes(group.roots)
                  .slice(0, 20)
                  .map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        void openResourceNode(item).catch((error: unknown) =>
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
  const [locale, setLocale] = useState('');
  const [proxy, setProxy] = useState('');
  useEffect(() => {
    setLocale(preferences.locale ?? '');
    setProxy(preferences.proxy ?? '');
  }, [preferences]);
  const save = (): void => {
    void run('settings', 'preferences', 'set', {
      ...(locale.trim() ? { locale: locale.trim() } : {}),
      ...(proxy.trim() ? { proxy: proxy.trim() } : {}),
    });
  };
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
          <Button onClick={save}>保存 App 默认</Button>
        </div>
      </Section>
      <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
        技能开关请使用「技能」卡片；浏览器白名单在「网站采集」。
      </p>
    </Panel>
  );
}

function ExtensionsCard() {
  const state = useResource<{
    list?: Array<{ id: string; source: string }>;
    errors?: string[];
    configured?: Array<{ source: string; scope: string }>;
    catalog?: Array<{
      name: string;
      description: string;
      types: string[];
      installSource: string;
    }>;
  }>('agent', 'extensions', {
    list: [],
    errors: [],
    configured: [],
    catalog: [],
  });
  const extensions = state.list ?? [];
  const configured = state.configured ?? [];
  const catalog = state.catalog ?? [];
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      setBusy(true);
      await action();
    } finally {
      setBusy(false);
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
          <Button
            disabled={busy}
            onClick={() =>
              void act(() =>
                run('agent', 'extensions', 'catalog', {
                  ...(query.trim() ? { query: query.trim() } : {}),
                  page: 1,
                }),
              )
            }
          >
            搜索
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {catalog.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.name}</div>
                <div className="truncate text-zinc-400">
                  {item.description} · {item.types.join(' / ')}
                </div>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    run('agent', 'extensions', 'install', {
                      name: item.name,
                    }),
                  )
                }
              >
                安装
              </Button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="安装 npm 包">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="npm 包名"
            className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-[12px] dark:border-[#303436] dark:bg-[#1c1e1f]"
          />
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              void act(async () => {
                await run('agent', 'extensions', 'install', {
                  name: name.trim(),
                });
                setName('');
              })
            }
          >
            安装
          </Button>
        </div>
      </Section>
      <div className="mb-2 flex justify-end">
        <Button onClick={() => void run('agent', 'extensions', 'reload')}>
          重新加载
        </Button>
      </div>
      {(state.errors ?? []).length > 0 && (
        <Section title="加载错误">
          {(state.errors ?? []).map((error, index) => (
            <div key={index} className="text-[11px] text-amber-600">
              {error}
            </div>
          ))}
        </Section>
      )}
      <Section title="已安装包">
        <div className="space-y-1">
          {configured.map((item) => (
            <div
              key={`${item.scope}:${item.source}`}
              className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-[#2c3039]"
            >
              <span className="min-w-0 flex-1 truncate font-mono">
                {item.source}
              </span>
              <Button
                onClick={() =>
                  void run('agent', 'extensions', 'remove', {
                    source: item.source,
                    scope: item.scope,
                  })
                }
              >
                卸载
              </Button>
            </div>
          ))}
          {configured.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无已安装包</p>
          )}
        </div>
      </Section>
      <Section title="已加载扩展">
        <div className="space-y-1">
          {extensions.map((extension) => (
            <div
              key={extension.id}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-[12px] dark:border-[#2c3039]"
            >
              <div className="truncate font-mono">{extension.source}</div>
            </div>
          ))}
          {extensions.length === 0 && (
            <p className="text-[12px] text-zinc-500">暂无已加载扩展</p>
          )}
        </div>
      </Section>
    </Panel>
  );
}

function UpdatesCard() {
  const update = useResource<{
    status: string;
    version: string | null;
    progress: number;
  }>('settings', 'updates', {
    status: 'idle',
    version: null,
    progress: 0,
  });
  const status: UpdateView = {
    phase: update.status,
    current: '',
    latest: update.version,
    received: update.progress,
    total: 100,
    file: null,
    message: null,
  };
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
function cardFromUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'work:' || url.hostname !== 'studio') return '';
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0] === 'settings' && parts[1] ? parts[1] : '';
  } catch {
    return '';
  }
}

function cardFromAddress(): string {
  return cardFromUrl(location.href);
}

/** 地址由主进程视图投影持有；页面只上报当前卡片，不直接改 document URL。 */
function publishCard(card: string): void {
  const url = card
    ? `work://studio/settings/${encodeURIComponent(card)}`
    : 'work://studio/settings';
  const wsId = window.workStudio?.workspaceId;
  if (!wsId) return;
  void command('shell', `${wsId}/views`, 'address', {
    url,
    title: '设置',
  }).catch(() => undefined);
}

function SettingsHome() {
  const pages = useSettingsPages();
  const [openCard, setOpenCard] = useState(cardFromAddress);
  const visible = useMemo(
    () => pages.filter((page) => !page.internal),
    [pages],
  );

  // document URL 不承担卡片路由（custom scheme 的 replaceState 会触发
  // Chromium bad IPC）；以 shell/views 的 active.url 为准，支持重载后恢复。
  useEffect(() => {
    const bridge = window.workStudio;
    if (!bridge) return;
    const wsId = bridge.workspaceId;
    if (!wsId) return;
    const views = `${wsId}/views`;
    let disposed = false;
    const apply = (value: unknown): void => {
      if (disposed || !Array.isArray(value)) return;
      const active = value.find(
        (item): item is { active?: boolean; url?: string } =>
          typeof item === 'object' &&
          item !== null &&
          (item as { active?: unknown }).active === true,
      );
      if (typeof active?.url !== 'string') return;
      if (!active.url.startsWith('work://studio/settings')) return;
      setOpenCard(cardFromUrl(active.url));
    };
    const off = bridge.onUpdate((update) => {
      if (
        update.domain === 'shell' &&
        update.resource === views &&
        update.type === 'snapshot'
      ) {
        apply(update.data);
      }
    });
    void bridge.subscribe('shell', views).then(apply);
    return () => {
      disposed = true;
      off();
      bridge.unsubscribe('shell', views);
    };
  }, []);

  // 从地址进入时展开对应卡片并滚到可见处。
  useEffect(() => {
    if (!openCard) return;
    const node = document.querySelector(`[data-page="${openCard}"]`);
    node?.scrollIntoView({ block: 'center' });
  }, [openCard, visible.length]);

  const toggle = (card: string, next: boolean): void => {
    const value = next ? card : '';
    setOpenCard(value);
    publishCard(value);
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
