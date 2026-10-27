/**
 * App / Workspace / Session 跨进程契约（architecture.md §2）。
 *
 * 渲染层只读 AppSnapshot，只发 AppCommand；事件带 scope / epoch。
 */

import type { ListSnapshot } from './lists';
import type { LayoutSnapshot } from './types';
import type {
  AgentSnapshot,
  ModelOption,
  PluginInfo,
  SessionMeta,
  ViewEntry,
} from './types';

export type Scope = 'app' | 'workspace' | 'session' | 'ui';

export interface ScopeEpochs {
  workspace: number;
  session: number;
}

export interface AppSnapshot {
  app: AppSlice;
  workspaces: WorkspaceMeta[];
  workspace: WorkspaceSlice;
  ui: WorkspaceUiSlice;
  session: SessionSlice;
  layout: LayoutSnapshot | null;
  seq: number;
  workspaceEpoch: number;
  sessionEpoch: number;
}

export interface AppCommand<T = unknown> {
  scope: Scope;
  action: string;
  payload?: T;
}

export interface AppEvent<T = unknown> {
  scope: Scope;
  epoch: number;
  seq: number;
  event: T;
}

export interface AppSlice {
  models: ModelCatalogView;
  credentials: CredentialStatus[];
  plugins: PluginInfo[];
  pluginSources: PluginSourceInfo[];
  resources: ResourceSet;
  settings: SettingsLayer;
}

export interface ModelCatalogView {
  providers: ProviderView[];
  models: ModelOption[];
  defaultModel: string | null;
}

export interface ProviderView {
  id: string;
  label: string;
  configured: boolean;
}

export interface CredentialStatus {
  providerId: string;
  configured: boolean;
  source: 'keychain' | 'env' | 'none';
}

export interface PluginSourceInfo {
  source: string;
  type: 'zip' | 'local';
  label?: string;
  sha256?: string;
  installedId?: string;
  version?: string;
}

export interface SettingsLayer {
  values: Record<string, unknown>;
}

export interface WorkspaceMeta {
  id: string;
  path: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface WorkspaceSlice {
  meta: WorkspaceMeta;
  settings: WorkspaceSettingsView;
  resources: WorkspaceResourceSet;
  lists: ListSnapshot;
  views: ViewEntry[];
  sessions: SessionMeta[];
}

export interface WorkspaceSettingsView {
  project: Record<string, unknown>;
  effective: Record<string, unknown>;
}

export interface WorkspaceUiSlice {
  theme: 'light' | 'dark';
  sidebar: {
    view: SidebarView;
    domain: string | null;
    collapsed: boolean;
  };
  paneWidths: { left: number; right: number };
  assistant: {
    open: boolean;
    floating: boolean;
    inputExpanded: boolean;
  };
  openSessionPaths: string[];
}

export type SidebarView =
  | 'main'
  | 'sessions'
  | 'docs'
  | 'data'
  | 'web'
  | 'plugins'
  | 'settings'
  | 'find';

export interface SessionSlice {
  meta: SessionMeta | null;
  status: 'idle' | 'streaming' | 'compacting' | 'error';
  streaming: StreamingState | null;
  queue: { steering: number; followUp: number };
  messages: unknown[];
  usage: { input: number; output: number; total: number };
  context: {
    resourceMapVersion: string;
    activeSkills: string[];
    agentsFileVersion: string | null;
  };
  snapshot: AgentSnapshot | null;
}

export interface StreamingState {
  sessionPath: string;
  startedAt: number;
  thinking?: string;
  text?: string;
}

export interface ResourceSet {
  extensions: InstalledExtension[];
  skills: ResourceSkillInfo[];
  packages: PiPackageInfo[];
  diagnostics: ResourceDiagnostic[];
}

export interface WorkspaceResourceSet extends ResourceSet {
  resourceMap: { ref: string; version: string };
  policy: ResourcePolicy;
}

export interface ResourcePolicy {
  enabledExtensions: string[];
  disabledExtensions: string[];
  defaultSkills: string[];
}

export interface InstalledExtension {
  id: string;
  name: string;
  version?: string;
  source: 'builtin' | 'package' | 'file';
  path: string;
  scope: 'app' | 'workspace';
  enabled: boolean;
  tools: string[];
  commands: string[];
}

export interface ResourceSkillInfo {
  name: string;
  description: string;
  source: 'app' | 'workspace' | 'plugin';
  path: string;
  manualOnly: boolean;
}

export interface PiPackageInfo {
  source: string;
  ref?: string;
  scope: 'app' | 'workspace';
  loaded: boolean;
  resources?: number;
}

export interface ResourceDiagnostic {
  type: 'info' | 'warn' | 'error';
  message: string;
  path?: string;
}
