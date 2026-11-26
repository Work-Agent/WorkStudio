/**
 * 插件注册表：App 级平铺列表，管理已安装与可安装插件。
 *
 * 与 workspace 的资源树是两套独立资源；这里不携带 wsId。
 */

export type PluginRegistryState =
  | 'installed'
  | 'available'
  | 'update'
  | 'broken';

export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  stage?: 'installed' | 'ready' | 'error' | 'broken';
  state: PluginRegistryState;
  installedVersion?: string;
  builtin?: boolean;
  hasConfig?: boolean;
  error?: string;
}

export interface PluginTaskView {
  id: string;
  source: string;
  label: string;
  status: 'running' | 'ready' | 'error' | 'cancelled';
  phase: string;
  received: number;
  total: number | null;
  message: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface PluginCatalogView {
  fetchedAt: number | null;
  stale: boolean;
  error?: string;
}

export interface PluginRegistrySnapshot {
  revision: number;
  installed: PluginRegistryEntry[];
  available: PluginRegistryEntry[];
  catalog: PluginCatalogView;
  task: PluginTaskView | null;
}
