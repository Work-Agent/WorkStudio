/**
 * settings 模块：设置宿主（生命周期 + 依赖）。
 *
 * storage 域订阅 workspace/registry 自行同步；模块只负责
 * 订阅的建立与释放，不依赖 App 调用。
 */

import { app, dialog, shell } from 'electron';
import { join } from 'node:path';
import { workUrl } from '../../../shared/pages.ts';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import { CallFailure } from '../../contract.ts';
import { createLog } from '../../log.ts';
import { activeWindowId } from '../shell/domains.ts';
import { UpdatesService } from './updates.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import {
  readUserPreferences,
  writeUserPreferences,
} from '../../platform/preferences.ts';
import { readJson, writeJson } from '../../platform/json.ts';
import { dataRootPointerFile, setDataRoot } from '../../platform/data-root.ts';
import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import {
  applyWorkspace,
  createPreferencesState,
  createSettingsState,
  createStorageState,
  createUpdateState,
  definePreferencesResource,
  definePagesResource,
  defineStorageResource,
  defineUpdatesResource,
  type PreferencesState,
  type SettingsPage,
  type SettingsState,
  type StorageState,
  type UpdateState,
} from './domains.ts';

export interface SettingsModuleOptions {
  layout: StorageLayout;
  pages?: SettingsPage[];
}

export class SettingsModule implements DomainModule {
  readonly id = 'settings';
  readonly dependencies = ['shell', 'workspace'] as const;

  private readonly settings: SettingsState;
  private readonly preferences: PreferencesState = createPreferencesState();
  private readonly storage: StorageState;
  private readonly updates: UpdateState = createUpdateState();
  private readonly updatesService: UpdatesService;
  private registry: DomainRegistry | null = null;
  private off: (() => void) | null = null;
  private offUpdates: (() => void) | null = null;

  constructor(private readonly options: SettingsModuleOptions) {
    this.settings = createSettingsState(options.pages ?? []);
    this.storage = createStorageState(options.layout);
    this.storage.versions = {
      app: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
    };
    this.updatesService = new UpdatesService(options.layout);
  }

  attach(registry: DomainRegistry): void {
    this.registry = registry;
    definePagesResource(registry, this.settings, (pageId) =>
      this.openPage(registry, pageId),
    );
    definePreferencesResource(registry, this.preferences, (values) =>
      writeUserPreferences(this.options.layout, values),
    );
    defineStorageResource(
      registry,
      this.storage,
      (path) => {
        void shell.openPath(path);
      },
      (path) => this.pickDataRoot(path),
      (path) => this.pickSessionDir(path),
    );
    defineUpdatesResource(registry, this.updates, this.updatesService);
  }

  start(): void {
    const registry = this.registry;
    if (!registry) return;

    const preferences = readUserPreferences(this.options.layout);
    this.preferences.locale = preferences.locale;
    this.preferences.proxy = preferences.proxy;
    this.preferences.githubToken = preferences.githubToken;
    this.preferences.updateSource = preferences.updateSource;

    const initial = registry.snapshot({
      domain: 'workspace',
      resource: 'registry',
    }) as { current: WorkspaceMeta | null } | null;
    applyWorkspace(
      registry,
      this.options.layout,
      this.storage,
      initial?.current ?? null,
    );

    this.offUpdates = this.updatesService.onChange(() => {
      registry.define('settings').resource('updates').publish();
    });
    this.off = registry.onUpdate((update) => {
      if (
        update.domain !== 'workspace' ||
        update.resource !== 'registry' ||
        update.type !== 'snapshot'
      ) {
        return;
      }
      applyWorkspace(
        registry,
        this.options.layout,
        this.storage,
        (update.data as { current: WorkspaceMeta | null }).current,
      );
    });
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.offUpdates?.();
    this.offUpdates = null;
    this.settings.pages.clear();
    this.preferences.locale = null;
    this.preferences.proxy = null;
    this.preferences.githubToken = null;
    this.preferences.updateSource = 'github';
    this.updates.status = 'idle';
    this.updates.version = null;
    this.updates.progress = 0;
    this.registry = null;
  }
  private async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  private async pickDataRoot(selected?: string): Promise<string | null> {
    const path = selected ?? (await this.pickDirectory());
    if (!path) return null;
    const profileDir = join(app.getPath('appData'), app.getName());
    setDataRoot(dataRootPointerFile(profileDir), path);
    return path;
  }

  private async pickSessionDir(selected?: string): Promise<string | null> {
    const path = selected ?? (await this.pickDirectory());
    if (!path) return null;
    const file = this.options.layout.userSettingsFile;
    const current = readJson(file);
    writeJson(file, { ...current, sessionDir: path });
    return path;
  }

  private async openPage(
    registry: Parameters<typeof definePagesResource>[0],
    pageId: string,
  ): Promise<unknown> {
    const page = this.settings.pages.get(pageId);
    if (!page) throw new CallFailure('not_found', `设置页不存在：${pageId}`);
    const welcome = pageId === 'welcome';
    const windowId = activeWindowId(registry);
    if (!windowId) throw new CallFailure('failed', '没有活动窗口');
    const result = await registry.dispatchCommand(
      { domain: 'shell', resource: `${windowId}/views` },
      'open',
      {
        id: welcome ? 'welcome' : `settings:${pageId}`,
        type: 'page',
        title: welcome ? '欢迎' : '设置',
        url: welcome ? workUrl('welcome') : workUrl('settings', pageId),
      },
      {
        origin: { type: 'service', id: 'settings' },
        changed: (ref, type) => registry.changed(ref, type),
        log: createLog('settings'),
      },
    );
    if (!result.ok)
      throw new CallFailure(result.error.code, result.error.message);
    return result.data;
  }
}
