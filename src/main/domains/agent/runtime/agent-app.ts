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
// pi-ai 默认用可变 specifier 动态加载 OAuth 流程（躲 bundler），打包后的
// 主进程里那个相对路径不存在；这里改用它自家的静态注册入口。
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import type { StorageLayout } from '../../../platform/paths.ts';
import type { SecretVault } from '../../../platform/vault.ts';
import type { Credential } from '@earendil-works/pi-ai';
import type {
  ModelCatalogItem,
  ModelOption,
  ProviderConfigView,
  ProviderCredentialInput,
  ProviderInfoView,
  SessionMeta,
} from '../../../../shared/types.ts';
import { ModelConfigStore, SettingsService } from './config-service.ts';
import { modelCatalog, providerCatalog } from './model-catalog.ts';
import { listSessions } from './session-list.ts';
import { AppSpaceSettingsStorage } from './settings-storage.ts';
import { SkillsManager } from './harness/skills.ts';
import { loginOAuth as runLoginOAuth } from './model-auth.ts';
import {
  AgentCredentials,
  migrateAgentDomain,
  migrateLegacyAuthFile,
} from './credentials.ts';
import { loginViaLoopback } from './page-login.ts';
import { isLoginOnly } from './model-catalog.ts';

function hostOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * 预置供应商：随宿主发布的快捷登录入口，用户可编辑或删除。
 * `loginUrl` 指向登录页，授权页登录成功后按域名回传凭证。
 */
const DEFAULT_PROVIDERS: Record<string, ProviderConfigView> = {
  simbalink: {
    name: 'Simbalink',
    baseUrl: 'https://titan-token.simbalink.cn/v1',
    api: 'openai-completions',
    loginUrl: 'https://titan-token.simbalink.cn/login',
    // one-api 部署：登录后用 /models 自动发现可用模型。
    discoverModels: true,
    models: [],
  },
};

export interface AgentAppOptions {
  storage: StorageLayout;
  /** App 级密钥库；供应商凭证落在 `agent` 域。 */
  vault: SecretVault;
  skills?: SkillsManager;
  extensionFactories?: InlineExtension[];
  additionalSkillPaths?: () => string[];
  skillOwner?: (source: string) => { id: string; label: string } | null;
  /** 打开 OAuth 授权页；由宿主接到内置标签页。 */
  openUrl?: (url: string) => void | Promise<void>;
}

export class AgentApp {
  readonly agentDir: string;
  readonly storage: StorageLayout;
  readonly skills: SkillsManager;
  readonly modelRuntime: ModelRuntime;
  readonly modelStore: ModelConfigStore;
  /** 凭证只落主进程：页面能提交，不能读回。 */
  readonly credentials: AgentCredentials;
  /** 模型 / 凭证变化后通知宿主（用于重建各工作区会话）。 */
  onChanged: (() => void) | null = null;
  /** 登录等流程的提示出口；不传则静默。 */
  onNotify: ((message: string) => void) | null = null;

  private constructor(
    private readonly modelRuntimeValue: ModelRuntime,
    private readonly options: AgentAppOptions,
    credentials: AgentCredentials,
    modelStore: ModelConfigStore,
  ) {
    this.storage = options.storage;
    this.agentDir = options.storage.dataRoot;
    this.skills = options.skills ?? new SkillsManager();
    this.modelRuntime = modelRuntimeValue;
    this.modelStore = modelStore;
    this.credentials = credentials;
  }

  static async create(options: AgentAppOptions): Promise<AgentApp> {
    // OAuth 登录走静态注册的流程模块；重复调用只是重新登记。
    registerBunOAuthFlows();
    const agentDir = options.storage.dataRoot;
    const modelStore = new ModelConfigStore(agentDir);
    for (const [providerId, config] of Object.entries(DEFAULT_PROVIDERS)) {
      if (modelStore.readView().providers[providerId]) continue;
      await modelStore.saveProvider(providerId, config).catch(() => undefined);
    }
    // 供应商的域是它的域名：配置里的 baseUrl 优先，内置 provider 取自 runtime。
    let runtime: ModelRuntime | null = null;
    const credentials = new AgentCredentials(options.vault, {
      hostOf: (providerId) => {
        const config = modelStore.readView().providers[providerId];
        const configured =
          typeof config?.baseUrl === 'string' ? config.baseUrl : undefined;
        return (
          hostOfUrl(configured) ??
          hostOfUrl(runtime?.getProvider(providerId)?.baseUrl)
        );
      },
      providerIds: () => [
        ...new Set([
          ...Object.keys(modelStore.readView().providers),
          ...(runtime?.getProviders() ?? []).map((provider) => provider.id),
        ]),
      ],
    });
    runtime = await ModelRuntime.create({
      credentials,
      modelsPath: join(agentDir, 'models.json'),
    });
    const app = new AgentApp(runtime, options, credentials, modelStore);
    // 迁移必须在 runtime 建好之后：迁完再刷新一次状态，避免启动时读到空域。
    await migrateAgentDomain(options.vault, credentials).catch(() => undefined);
    migrateLegacyAuthFile(credentials, join(agentDir, 'auth.json'));
    await runtime.refresh({ allowNetwork: false }).catch(() => null);
    return app;
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

  openUrl(url: string): void | Promise<void> {
    return this.options.openUrl?.(url);
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

  /** 该供应商是否用 OpenAI 兼容的 /models 自动发现模型。 */
  private discoversModels(providerId: string): boolean {
    const config = this.modelStore.readView().providers[providerId];
    return config?.['discoverModels'] === true;
  }

  /**
   * 用已存凭证拉取 `${baseUrl}/models`，把模型写进 models.json。
   * one-api 这类 OpenAI 兼容服务只暴露脚本里的模型，靠它补齐目录。
   */
  async refreshProviderModels(providerId: string): Promise<number> {
    const provider = this.modelRuntime.getProvider(providerId);
    const baseUrl = provider?.baseUrl;
    if (!baseUrl) throw new Error(`供应商没有 baseUrl：${providerId}`);
    const credential = await this.credentials.read(providerId);
    const key =
      credential?.type === 'api_key' ? credential.key : credential?.access;
    if (!key) throw new Error(`供应商未登录：${providerId}`);
    const endpoint = new URL(baseUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/`;
    const response = await fetch(new URL('models', endpoint), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`模型列表请求失败：${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    let saved = 0;
    for (const item of body.data ?? []) {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) continue;
      await this.modelStore.saveModel(providerId, {
        id,
        ...(typeof item.name === 'string' && item.name.trim()
          ? { name: item.name.trim() }
          : {}),
      });
      saved += 1;
    }
    await this.refreshModels();
    return saved;
  }

  /**
   * 快捷登录：打开供应商登录页，等它 302 回本机回调后直接写密钥库。
   * 全程主进程完成，页面只负责完成登录并跳回。
   */
  async loginViaPage(providerId: string): Promise<void> {
    const config = this.modelStore.readView();
    const provider = this.getProviderCatalog(
      Object.keys(config.providers),
    ).find((item) => item.id === providerId);
    if (!provider) throw new Error(`未知供应商：${providerId}`);
    if (!provider.loginUrl)
      throw new Error(`该供应商没有登录页：${providerId}`);
    const credential = await loginViaLoopback({
      providerId,
      loginUrl: provider.loginUrl,
      openUrl: (url) => this.openUrl(url),
      notify: (message) => this.onNotify?.(message),
    });
    await this.applyCredential(providerId, credential);
  }

  getProviderCatalog(customProviderIds: string[]): ProviderInfoView[] {
    return providerCatalog(
      this.modelRuntime,
      customProviderIds,
      this.modelStore.readView().providers,
    );
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

  /**
   * API Key 路线：声明了授权页的供应商只走登录，这里按同一判据拒绝；
   * 拒绝在写入前，页面与命令通道共用一个入口。
   */
  async configureApiKey(providerId: string, apiKey: string): Promise<void> {
    const config = this.modelStore.readView().providers[providerId];
    if (isLoginOnly(config)) {
      throw new Error(`该供应商只支持登录：${providerId}`);
    }
    await this.applyCredential(providerId, { accessToken: apiKey });
  }

  /**
   * 凭证落点（唯一的写入实现）：OAuth 回调、页面登录回调、API Key 配置、
   * 插件写凭证最后都走这里。只有 accessToken 的按 api_key 存；带 refresh /
   * 有效期的按 oauth 存。provider 必须存在，凭证只进主进程密钥库。
   */
  async applyCredential(
    providerId: string,
    input: ProviderCredentialInput,
  ): Promise<void> {
    if (!this.modelRuntime.getProvider(providerId)) {
      throw new Error(`未知供应商：${providerId}`);
    }
    const access = input.accessToken?.trim();
    if (!access) throw new Error('缺少 accessToken');
    const extra = input.extra ?? {};
    const expires =
      typeof input.expiresIn === 'number' && Number.isFinite(input.expiresIn)
        ? Date.now() + input.expiresIn * 1000
        : undefined;
    const refresh = input.refreshToken?.trim();
    const credential: Credential =
      refresh || expires !== undefined
        ? {
            type: 'oauth',
            access,
            refresh: refresh ?? '',
            expires: expires ?? Date.now(),
            ...extra,
          }
        : { type: 'api_key', key: access };
    await this.credentials.modify(providerId, async () => credential);
    await this.modelRuntime
      .refresh({ providers: [providerId], allowNetwork: true })
      .catch(() => null);
    this.onChanged?.();
    if (this.discoversModels(providerId)) {
      void this.refreshProviderModels(providerId).catch(() => null);
    }
  }

  async logoutProvider(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId);
    await this.modelRuntime.refresh({ providers: [providerId] });
    this.onChanged?.();
  }

  async loginProvider(
    input: { providerId: string },
    ui: {
      askDialog: (
        dialogType: 'select' | 'input' | 'editor' | 'confirm',
        fields: Record<string, unknown>,
        opts?: { signal?: AbortSignal },
      ) => Promise<string | boolean | undefined>;
      dialogHost: () => unknown;
      notify: (message: string, level: 'info' | 'warning' | 'error') => void;
      emitStatus: () => void;
    },
  ): Promise<void> {
    await runLoginOAuth(
      {
        runtime: () => this.modelRuntime,
        askDialog: ui.askDialog,
        dialogHost: ui.dialogHost as never,
        notify: (message, level) => ui.notify(message, level),
        openUrl: this.options.openUrl,
        emitStatus: ui.emitStatus,
      },
      { providerId: input.providerId },
    );
    // OAuth 登录会带来新的模型目录；刷新宿主投影（runLoginOAuth 已完成网络刷新）。
    this.onChanged?.();
    ui.emitStatus();
  }

  private async refreshModels(): Promise<void> {
    await this.modelRuntime.refresh({ allowNetwork: false }).catch(() => null);
    this.onChanged?.();
  }
}
