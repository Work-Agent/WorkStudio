/**
 * settings 模块持有的 System Domain：
 * settings 服务的 resources：pages · preferences · storage · updates。
 *
 * 域只声明状态切片与命令；storage 与 workspace 的同步
 * 放在模块 start / stop 里，不依赖 App 调用。
 */

import { join } from 'node:path';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import type { UpdatesService } from './updates.ts';
import { pending } from '../../registry/command.ts';
import { CallFailure } from '../../contract.ts';
import type { DomainRegistry } from '../../registry/registry.ts';

// ─── settings ────────────────────────────────────────────────

export interface SettingsPage {
  id: string;
  label: string;
  desc: string;
  icon: string;
  internal?: boolean;
}

export interface SettingsState {
  readonly pages: Map<string, SettingsPage>;
}

export function createSettingsState(pages: SettingsPage[]): SettingsState {
  const state = new Map<string, SettingsPage>();
  for (const page of pages) state.set(page.id, page);
  return { pages: state };
}

export function definePagesResource(
  registry: DomainRegistry,
  state: SettingsState,
  openPage?: (pageId: string) => Promise<unknown>,
): void {
  const resource = registry.define('settings').resource('pages');
  resource.snapshot(() => [...state.pages.values()]);
  resource.command('open', {
    summary: '打开设置卡片',
    args: {
      pageId: { type: 'string' },
      id: { type: 'string' },
    },
    run: openPage
      ? (input) => openPage(String(input.pageId ?? input.id ?? ''))
      : pending('settings/open'),
  });
}

// ─── preferences ─────────────────────────────────────────────

export interface PreferencesState {
  locale: string | null;
  proxy: string | null;
  githubToken: string | null;
}

export interface PreferenceValues {
  locale: string | null;
  proxy: string | null;
  githubToken: string | null;
}

export function createPreferencesState(): PreferencesState {
  return { locale: null, proxy: null, githubToken: null };
}

export function definePreferencesResource(
  registry: DomainRegistry,
  state: PreferencesState,
  persist?: (values: PreferenceValues) => void,
): void {
  const resource = registry.define('settings').resource('preferences');
  resource.snapshot(() => ({
    locale: state.locale,
    proxy: state.proxy,
    githubToken: state.githubToken,
  }));
  resource.command('set', {
    summary: '更新全局偏好',
    args: {
      locale: { type: 'string' },
      proxy: { type: 'string' },
      githubToken: { type: 'string' },
    },
    run: (input) => {
      if (typeof input.locale === 'string') state.locale = input.locale;
      if (typeof input.proxy === 'string') state.proxy = input.proxy;
      if (typeof input.githubToken === 'string') {
        state.githubToken = input.githubToken;
      }
      persist?.({
        locale: state.locale,
        proxy: state.proxy,
        githubToken: state.githubToken,
      });
      resource.patch({
        locale: state.locale,
        proxy: state.proxy,
        githubToken: state.githubToken,
      });
      return {
        locale: state.locale,
        proxy: state.proxy,
        githubToken: state.githubToken,
      };
    },
  });
}

// ─── storage ─────────────────────────────────────────────────

export interface StorageState {
  dataRoot: string;
  workspacesRoot: string;
  workspacePath: string;
  workspaceId: string;
  sessionsDir: string;
  versions: { app: string; electron: string; chrome: string; node: string };
}

export function createStorageState(layout: StorageLayout): StorageState {
  return {
    dataRoot: layout.dataRoot,
    workspacesRoot: layout.workspacesRoot,
    workspacePath: '',
    workspaceId: '',
    sessionsDir: join(layout.workspacesRoot, 'sessions'),
    versions: { app: '', electron: '', chrome: '', node: '' },
  };
}

/** 工作区切换只更新 storage 投影，不动 App 级偏好。 */
export function applyWorkspace(
  registry: DomainRegistry,
  layout: StorageLayout,
  state: StorageState,
  meta: WorkspaceMeta | null,
): void {
  state.workspaceId = meta?.id ?? '';
  state.workspacePath = meta?.path ?? '';
  state.sessionsDir = meta
    ? layout.sessionsDir(meta.id)
    : join(layout.workspacesRoot, 'sessions');
  registry.define('settings').resource('storage').publish();
}

export function defineStorageResource(
  registry: DomainRegistry,
  state: StorageState,
  openPath?: (path: string) => void,
  changeDataRoot?: (path?: string) => Promise<string | null>,
  changeSessionDir?: (path?: string) => Promise<string | null>,
): void {
  const resource = registry.define('settings').resource('storage');
  resource.snapshot(() => ({
    dataRoot: state.dataRoot,
    workspacesRoot: state.workspacesRoot,
    workspacePath: state.workspacePath,
    workspaceId: state.workspaceId,
    sessionsDir: state.sessionsDir,
    versions: state.versions,
  }));
  resource.command('changeDataRoot', {
    summary: '更换数据根（重启后生效）',
    args: { path: { type: 'string' } },
    run: async (input) => {
      if (!changeDataRoot) throw new CallFailure('failed', '数据根切换未接入');
      return changeDataRoot(
        typeof input.path === 'string' ? input.path : undefined,
      );
    },
  });
  resource.command('changeSessionDir', {
    summary: '更换会话目录',
    args: { path: { type: 'string' } },
    run: async (input) => {
      if (!changeSessionDir) {
        throw new CallFailure('failed', '会话目录切换未接入');
      }
      const path = await changeSessionDir(
        typeof input.path === 'string' ? input.path : undefined,
      );
      if (path) {
        state.sessionsDir = path;
        resource.publish();
      }
      return path;
    },
  });
  resource.command('openPath', {
    summary: '在系统文件管理器中打开路径',
    args: { path: { type: 'string', required: true } },
    run: openPath
      ? (input) => {
          openPath(String(input.path));
          return null;
        }
      : pending('storage/openPath'),
  });
}

// ─── updates ─────────────────────────────────────────────────

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number;
}

export function createUpdateState(): UpdateState {
  return { status: 'idle', version: null, progress: 0 };
}

export function defineUpdatesResource(
  registry: DomainRegistry,
  state: UpdateState,
  service?: UpdatesService,
): void {
  const resource = registry.define('settings').resource('updates');
  resource.snapshot(() => {
    if (!service) {
      return {
        status: state.status,
        version: state.version,
        progress: state.progress,
      };
    }
    const current = service.current();
    return {
      status: current.phase,
      version: current.latest,
      progress:
        current.total > 0
          ? Math.round((current.received / current.total) * 100)
          : 0,
    };
  });
  resource.command('check', {
    summary: '检查更新',
    args: {},
    run: service ? () => service.check() : pending('updates/check'),
  });
  resource.command('download', {
    summary: '下载更新',
    args: {},
    run: service ? () => service.download() : pending('updates/download'),
  });
  resource.command('cancel', {
    summary: '取消更新',
    args: {},
    run: service ? () => service.cancel() : pending('updates/cancel'),
  });
  resource.command('open', {
    summary: '打开已下载的更新包',
    args: {},
    run: service
      ? () => {
          service.open();
          return null;
        }
      : pending('updates/open'),
  });
}
