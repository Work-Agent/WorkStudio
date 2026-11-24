/**
 * settings domain：应用设置、偏好、外观、存储视图与更新。
 *
 * 更新状态是设置页的一部分，和设置资源共享同一生命周期。
 */

import { nativeTheme } from 'electron';
import { join } from 'node:path';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import {
  normalizeAppearance,
  resolveAppearance,
  type AppearanceSettings,
  type AppearanceSnapshot,
} from '../../../shared/appearance.ts';
import type { DomainModule, DomainRegistry } from '../../runtime/domains.ts';
import type { SystemActions, ThemeManager } from '../shell/native.ts';
import { setDataRoot } from '../../runtime/storage/data-root.ts';
import {
  readUserPreferences,
  readWorkspacePolicy,
  writeBrowserAllowlist,
  writeUserPreferences,
} from '../../runtime/storage/preferences.ts';
import type { StoragePaths } from '../../runtime/storage/storage-paths.ts';
import type { Views } from '../shell/views.ts';
import type { AgentDomain } from '../agent/module.ts';
import type { WorkspaceModule } from '../workspace/module.ts';
import { BUNDLED_GITHUB_TOKEN } from '../workspace/plugins/github.ts';
import { uraRegistry } from '../workspace/ura/registry.ts';
import { settingsPages } from './registry.ts';
import type { SettingsStorageView } from './resources.ts';
import { defineSettingsDomain } from './resources.ts';
import { defineUpdatesDomain } from './update-resources.ts';
import { UpdatesService } from './updates/service.ts';
import { UpdateService } from './updates/updater.ts';

export interface SettingsDomainOptions {
  current(): WorkspaceMeta | null;
  storage: StoragePaths;
  workspace: WorkspaceModule;
  agent: AgentDomain;
  theme: ThemeManager;
  views: Views;
  actions: SystemActions;
  openSettings(pageId: string): Promise<{ id: string }>;
  onBrowserChanged(): void;
  appPath(): string;
  appVersion(): string;
}

export class SettingsDomain implements DomainModule {
  readonly dependencies = ['shell', 'workspace', 'agent'] as const;
  readonly id = 'settings';
  private readonly options: SettingsDomainOptions;
  private readonly updates: UpdatesService;
  private registry: DomainRegistry | null = null;

  constructor(options: SettingsDomainOptions) {
    this.options = options;
    this.updates = new UpdatesService(
      new UpdateService({
        token: () =>
          process.env['GITHUB_TOKEN'] ??
          readUserPreferences().githubToken ??
          BUNDLED_GITHUB_TOKEN,
      }),
    );
    this.updates.onChange(() => this.publishUpdates());
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    defineSettingsDomain(registry, {
      pages: () => settingsPages(),
      open: (pageId) => this.options.openSettings(pageId),
      appearance: () => this.appearanceSnapshot(),
      setAppearance: (patch) => this.updateAppearance(patch),
      storage: () => this.storageView(),
      openPath: (path) => this.options.actions.openPath(path),
      changeDataRoot: async () => {
        const path = await this.options.actions.pickDirectory(
          this.options.current()?.id,
        );
        if (path) setDataRoot(path);
        return path ?? null;
      },
      changeSessionDir: async () => {
        const path = await this.options.actions.pickDirectory(
          this.options.current()?.id,
        );
        if (!path) return null;
        this.options.agent.settingsRef()?.setGlobal('sessionDir', path);
        await this.options.agent.hostRef()?.rebuildForWorkspace();
        this.publish();
        return path;
      },
      resourceDiagnostics: () => ({
        ...uraRegistry.snapshot(),
        diagnostics: uraRegistry.diagnostics(),
      }),
      browser: () => {
        const workspace = this.options.current();
        return {
          allowlist: workspace
            ? readWorkspacePolicy(workspace.id).browser.allowlist
            : [],
        };
      },
      setBrowser: (allowlist) => {
        const workspace = this.options.current();
        if (workspace) {
          writeBrowserAllowlist(workspace.id, allowlist);
          this.options.onBrowserChanged();
        }
        this.publish();
        return { allowlist };
      },
      extensions: () =>
        this.options.agent.packagesRef()?.listConfigured() ?? [],
      installExtension: async (name) => {
        await this.options.agent.ensure();
        await this.options.agent.packagesRef()?.install(name);
        this.publish();
      },
      searchExtensions: async (input) => {
        await this.options.agent.ensure();
        return (
          this.options.agent.packagesRef()?.searchCatalog(input) ?? {
            packages: [],
            total: 0,
          }
        );
      },
      removeExtension: async (source, scope) => {
        await this.options.agent.ensure();
        await this.options.agent.packagesRef()?.remove(source, scope);
        this.publish();
      },
      preferences: () => {
        const preferences = readUserPreferences();
        return {
          theme: preferences.theme,
          locale: preferences.locale,
          proxy: preferences.proxy,
          githubToken: preferences.githubToken,
        };
      },
      advanced: () => ({
        settings: this.options.agent.settingsRef()?.view() ?? null,
        bindings: this.options.workspace.ura()?.ura.bindings() ?? [],
      }),
      setGlobalSetting: (path, value) => {
        const next = this.options.agent.settingsRef()!.setGlobal(path, value);
        this.publish();
        return next;
      },
      setProjectSetting: (path, value) => {
        const next = this.options.agent.settingsRef()!.setProject(path, value);
        this.publish();
        return next;
      },
      reloadAdvanced: () => this.options.agent.settingsRef()?.reload() ?? null,
      replaceSettings: (scope, value) => {
        const next = this.options.agent.settingsRef()!.replace(scope, value);
        this.publish();
        return next;
      },
      setBinding: async (binding) => {
        const runtime = await this.options.workspace.ensure();
        return runtime.ura.ura.setBinding(binding as never);
      },
      removeBinding: async (transport, mime) => {
        const runtime = await this.options.workspace.ensure();
        return runtime.ura.ura.removeBinding(transport, mime);
      },
      setPreferences: (patch) => {
        const next = writeUserPreferences(patch);
        if (patch.theme) this.options.theme.apply(patch.theme);
        this.publish();
        return {
          theme: next.theme,
          locale: next.locale,
          proxy: next.proxy,
          githubToken: next.githubToken,
        };
      },
    });
    defineUpdatesDomain(registry, {
      status: () => this.updates.status(),
      check: () => this.updates.check(),
      download: () => this.updates.download(),
      cancel: () => this.updates.cancel(),
      install: () => this.updates.install(),
      open: () => {
        const file = this.updates.status().file;
        if (file) this.options.actions.openPath(file);
      },
    });
  }

  publish(): void {
    const registry = this.registry;
    if (!registry) return;
    const domain = registry.define('settings');
    for (const name of [
      'pages',
      'appearance',
      'storage',
      'browser',
      'preferences',
      'advanced',
      'resourceInfo',
      'extensions',
    ]) {
      domain.resource(name).publish();
    }
  }

  publishUpdates(): void {
    this.registry?.define('settings').resource('updates').publish();
  }

  setThemeSource(source: 'light' | 'dark' | 'system'): void {
    const current = readUserPreferences();
    const appearance = normalizeAppearance(
      { ...current.appearance, theme: source },
      current.theme,
    );
    writeUserPreferences({
      appearance,
      theme: source === 'system' ? current.theme : source,
    });
    this.publish();
  }

  private appearanceSnapshot(): AppearanceSnapshot {
    const preferences = readUserPreferences();
    return resolveAppearance(
      preferences.appearance,
      nativeTheme.shouldUseDarkColors,
    );
  }

  private updateAppearance(
    patch: Partial<AppearanceSettings>,
  ): AppearanceSnapshot {
    const current = readUserPreferences();
    const appearance = normalizeAppearance(
      { ...current.appearance, ...patch },
      current.theme,
    );
    writeUserPreferences({ appearance });
    const snapshot = resolveAppearance(
      appearance,
      nativeTheme.shouldUseDarkColors,
    );
    writeUserPreferences({ appearance, theme: snapshot.effectiveTheme });
    this.options.theme.apply(appearance.theme);
    this.options.views.setZoomFactor(appearance.zoom / 100);
    this.publish();
    return snapshot;
  }

  private storageView(): SettingsStorageView {
    const workspace = this.options.current();
    const base = workspace
      ? this.options.storage.workspaceBase(workspace.id)
      : '';
    return {
      dataRoot: this.options.storage.dataRoot,
      appPath: this.options.appPath(),
      workspacePath: workspace?.path ?? '',
      workspaceId: workspace?.id ?? '',
      sceneFile: base ? join(base, 'scene.json') : '',
      sessionsDir:
        this.options.agent.sessionsDir() ||
        (base ? join(base, 'sessions') : ''),
      versions: {
        app: this.options.appVersion(),
        electron: process.versions['electron'] ?? '',
        chrome: process.versions['chrome'] ?? '',
        node: process.versions['node'] ?? '',
      },
    };
  }
}
