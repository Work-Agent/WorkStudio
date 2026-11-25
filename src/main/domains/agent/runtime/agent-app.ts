/**
 * Agent 的 App 级服务：模型、凭证、设置存储、技能与会话列表。
 *
 * 工作区之间共享同一份 ModelRuntime / SkillsManager；每个工作区只持有自己的
 * AgentSessionRuntime（cwd 与会话不同）。
 */

import { isAbsolute, join } from 'node:path';
import {
  ModelRuntime,
  SettingsManager,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import type { StorageLayout } from '../../../platform/paths.ts';
import type {
  ModelCatalogItem,
  ModelOption,
  ProviderInfoView,
  SessionMeta,
} from '../../../../shared/types.ts';
import { ModelConfigStore, SettingsService } from './config-service.ts';
import { modelCatalog, providerCatalog } from './model-catalog.ts';
import { listSessions } from './session-list.ts';
import { AppSpaceSettingsStorage } from './settings-storage.ts';
import { SkillsManager } from './harness/skills.ts';
import { loginProvider as runProviderLogin } from './model-auth.ts';

export interface AgentAppOptions {
  storage: StorageLayout;
  skills?: SkillsManager;
  extensionFactories?: InlineExtension[];
  additionalSkillPaths?: () => string[];
  skillOwner?: (source: string) => { id: string; label: string } | null;
  openExternal?: (url: string) => void | Promise<void>;
}

export class AgentApp {
  readonly agentDir: string;
  readonly storage: StorageLayout;
  readonly skills: SkillsManager;
  readonly modelRuntime: ModelRuntime;
  readonly modelStore: ModelConfigStore;
  private readonly oauthStates = new Set<string>();
  /** 模型 / 凭证变化后通知宿主（用于重建各工作区会话）。 */
  onChanged: (() => void) | null = null;

  private constructor(
    private readonly modelRuntimeValue: ModelRuntime,
    private readonly options: AgentAppOptions,
  ) {
    this.storage = options.storage;
    this.agentDir = options.storage.dataRoot;
    this.skills = options.skills ?? new SkillsManager();
    this.modelRuntime = modelRuntimeValue;
    this.modelStore = new ModelConfigStore(this.agentDir);
  }

  static async create(options: AgentAppOptions): Promise<AgentApp> {
    const agentDir = options.storage.dataRoot;
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    });
    return new AgentApp(modelRuntime, options);
  }

  get extensionFactories(): InlineExtension[] {
    return this.options.extensionFactories ?? [];
  }

  additionalSkillPaths(): string[] {
    return this.options.additionalSkillPaths?.() ?? [];
  }

  skillOwner(source: string): { id: string; label: string } | null {
    return this.options.skillOwner?.(source) ?? null;
  }

  openExternal(url: string): void | Promise<void> {
    return this.options.openExternal?.(url);
  }

  settingsStorageFor(workspaceId: string): AppSpaceSettingsStorage {
    return new AppSpaceSettingsStorage(
      join(this.storage.dataRoot, 'settings.json'),
      join(this.storage.workspaceBase(workspaceId), 'settings.json'),
    );
  }

  settingsManagerFor(workspaceId: string): SettingsManager {
    return SettingsManager.fromStorage(this.settingsStorageFor(workspaceId), {
      projectTrusted: true,
    });
  }

  settingsServiceFor(workspaceId: string): SettingsService {
    return new SettingsService(this.settingsStorageFor(workspaceId));
  }

  listSessions(workspaceId: string, path: string): Promise<SessionMeta[]> {
    return listSessions(path, this.storage.sessionsDir(workspaceId));
  }

  listedSessionsDir(workspaceId: string, configured?: string | null): string {
    if (configured) {
      return isAbsolute(configured)
        ? configured
        : join(this.storage.workspaceBase(workspaceId), configured);
    }
    return this.storage.sessionsDir(workspaceId);
  }

  models(): ModelOption[] {
    return this.modelRuntime.getAvailableSnapshot().map((model) => ({
      provider: model.provider,
      modelId: model.id,
      label: model.name ?? model.id,
    }));
  }

  getProviderCatalog(customProviderIds: string[]): ProviderInfoView[] {
    return providerCatalog(this.modelRuntime, customProviderIds);
  }

  getModelCatalog(): ModelCatalogItem[] {
    return modelCatalog(this.modelRuntime);
  }

  getModelsView(): unknown {
    const config = this.modelStore.readView();
    return {
      providers: this.getProviderCatalog(Object.keys(config.providers)),
      catalog: this.getModelCatalog(),
      config,
    };
  }

  async saveProvider(providerId: string, config: unknown): Promise<void> {
    await this.modelStore.saveProvider(providerId, config as never);
    await this.refreshModels();
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.modelStore.deleteProvider(providerId);
    await this.refreshModels();
  }

  async saveModel(providerId: string, model: unknown): Promise<void> {
    await this.modelStore.saveModel(providerId, model as never);
    await this.refreshModels();
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    await this.modelStore.deleteModel(providerId, modelId);
    await this.refreshModels();
  }

  beginOAuth(providerId: string, state: string): void {
    this.oauthStates.add(`${providerId}:${state}`);
  }

  async completeOAuth(
    providerId: string,
    state: string,
    input: { accessToken?: string },
  ): Promise<void> {
    const key = `${providerId}:${state}`;
    if (!this.oauthStates.delete(key)) {
      throw new Error('OAuth state 不匹配或已过期');
    }
    if (input.accessToken) {
      await this.modelRuntime.setRuntimeApiKey(providerId, input.accessToken);
      await this.modelRuntime.refresh({
        providers: [providerId],
        allowNetwork: true,
      });
      this.onChanged?.();
      return;
    }
    throw new Error('OAuth 回调缺少 accessToken');
  }

  async logoutProvider(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId);
    await this.modelRuntime.refresh({ providers: [providerId] });
    this.onChanged?.();
  }

  async loginProvider(
    input: {
      providerId: string;
      type: 'api_key' | 'oauth';
      apiKey?: string;
    },
    ui: {
      askDialog: (
        dialogType: 'select' | 'input' | 'editor' | 'confirm',
        fields: Record<string, unknown>,
      ) => Promise<string | boolean | undefined>;
      dialogHost: () => unknown;
      notify: (message: string, level: 'info' | 'warning' | 'error') => void;
      emitStatus: () => void;
    },
  ): Promise<void> {
    if (input.type === 'api_key' && input.apiKey) {
      await this.modelRuntime.setRuntimeApiKey(input.providerId, input.apiKey);
      await this.modelRuntime.refresh({ providers: [input.providerId] });
      this.onChanged?.();
      ui.emitStatus();
      return;
    }
    await runProviderLogin(
      {
        runtime: () => this.modelRuntime,
        askDialog: ui.askDialog,
        dialogHost: ui.dialogHost as never,
        notify: (message, level) => ui.notify(message, level),
        openExternal: this.options.openExternal,
        emitStatus: ui.emitStatus,
      },
      { providerId: input.providerId, type: 'oauth' },
    );
  }

  private async refreshModels(): Promise<void> {
    await this.modelRuntime.refresh({ allowNetwork: false }).catch(() => null);
    this.onChanged?.();
  }
}
