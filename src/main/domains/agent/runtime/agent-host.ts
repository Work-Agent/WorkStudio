/**
 * AgentHost：pi runtime 的宿主封装。
 *
 * 只负责装配、会话换代与快照；工具/资源层通过后续注入扩展，
 * 不在这个类里引用工作区服务或插件宿主。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  SessionManager,
  SettingsManager,
  createAgentSessionRuntime,
  type AgentSession as PiAgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import type { StorageLayout } from '../../../platform/paths.ts';
import type {
  AgentSnapshot,
  AppInternalEvent,
  LoadedResourcesView,
  ModelCatalogItem,
  ModelOption,
  ParsedMessage,
  PiEventFrame,
  ProviderInfoView,
  SessionMeta,
  ThinkingLevel,
} from '../../../../shared/types.ts';
import { EventBridge } from './event-bridge.ts';
import { ModelConfigStore, SettingsService } from './config-service.ts';
import { modelCatalog, providerCatalog } from './model-catalog.ts';
import { loadedResources } from './resources-view.ts';
import { listSessions } from './session-list.ts';
import { AppSpaceSettingsStorage } from './settings-storage.ts';
import { readSessionMessages, deleteSessionFile } from './session-index.ts';
import { SkillsManager } from './harness/skills.ts';
import { AgentSession as WorkAgentSession } from './session.ts';
import { DialogHost, makeUiContext } from './ui-context.ts';
import { loginProvider as runProviderLogin } from './model-auth.ts';

export interface AgentHostOptions {
  storage: StorageLayout;
  workspacePath: string;
  skills?: SkillsManager;
  sendEvent?: (frame: PiEventFrame) => void;
  onTurnFinished?: () => void;
  onSessionCreated?: (path: string) => void;
  onWorkspaceChange?: (path: string) => void;
  openExternal?: (url: string) => void | Promise<void>;
  extensionFactories?: InlineExtension[];
  additionalSkillPaths?: () => string[];
  skillOwner?: (source: string) => { id: string; label: string } | null;
  ui?: {
    onDialogRequest: (
      request: import('../../../../shared/types.ts').UiDialogRequest,
    ) => void;
    onDialogResolved: (id: string, reason: string) => void;
    onNotify: (
      message: string,
      level: 'info' | 'warning' | 'error',
      source: string,
    ) => void;
  };
}

export class AgentHost {
  readonly bridge: EventBridge;
  private runtime!: AgentSessionRuntime;
  private workspacePath: string;
  private settingsStorage!: AppSpaceSettingsStorage;
  private readonly agentDir: string;
  private readonly skills: SkillsManager;
  private readonly modelStore: ModelConfigStore;
  private readonly oauthStates = new Set<string>();
  private pendingReason = 'replace';
  private dialogHost: DialogHost | null = null;
  private editorText = '';

  private constructor(private readonly options: AgentHostOptions) {
    this.workspacePath = options.workspacePath;
    this.agentDir = options.storage.dataRoot;
    this.skills = options.skills ?? new SkillsManager();
    this.modelStore = new ModelConfigStore(this.agentDir);
    this.bridge = new EventBridge((frame) => options.sendEvent?.(frame));
  }

  static async bootstrap(options: AgentHostOptions): Promise<AgentHost> {
    process.env['PI_SKIP_VERSION_CHECK'] = '1';
    mkdirSync(options.storage.dataRoot, { recursive: true });
    const host = new AgentHost(options);
    const workspaceId = workspaceIdOf(options.workspacePath);
    host.settingsStorage = new AppSpaceSettingsStorage(
      join(options.storage.dataRoot, 'settings.json'),
      join(options.storage.workspaceBase(workspaceId), 'settings.json'),
    );
    const sessionManager = SessionManager.create(
      options.workspacePath,
      options.storage.sessionsDir(workspaceId),
    );
    host.runtime = await createAgentSessionRuntime(host.createFactory(), {
      cwd: options.workspacePath,
      agentDir: host.agentDir,
      sessionManager,
    });
    host.installRebindHooks();
    host.bridge.attach(host.runtime.session);
    await host.bindCurrentSessionExtensions();
    return host;
  }

  get session(): PiAgentSession {
    return this.runtime.session;
  }

  get services() {
    return this.runtime.services;
  }

  get modelRuntime() {
    return this.runtime.services.modelRuntime;
  }

  get settingsManager(): SettingsManager {
    return this.runtime.services.settingsManager;
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  skillsRef(): SkillsManager {
    return this.skills;
  }

  resolveSessionsDir(): string {
    const configured = this.settingsManager.getSessionDir?.();
    if (configured) {
      return isAbsolute(configured)
        ? configured
        : join(this.workspacePath, configured);
    }
    return this.options.storage.sessionsDir(workspaceIdOf(this.workspacePath));
  }

  get settingsService(): SettingsService {
    return new SettingsService(this.settingsStorage);
  }

  getSnapshot(): AgentSnapshot {
    const s = this.session;
    const model = s.model as
      | { provider: string; id: string; name?: string }
      | undefined;
    const configured =
      model != null && model.provider !== 'unknown' && model.id !== 'unknown';
    return {
      configured,
      ...(configured
        ? {
            provider: model.provider,
            modelId: model.id,
            modelName: model.name ?? model.id,
          }
        : {}),
      thinkingLevel: (s.thinkingLevel as ThinkingLevel | undefined) ?? null,
      isStreaming: s.isStreaming,
      isCompacting: s.isCompacting,
      steeringMode: s.steeringMode,
      followUpMode: s.followUpMode,
      sessionFile: s.sessionFile ?? null,
      sessionId: s.sessionId ?? null,
      sessionName: s.sessionName ?? null,
      messageCount: s.messages.length,
      pendingMessageCount: s.pendingMessageCount,
      cwd: this.workspacePath,
      workspacePath: this.workspacePath,
    };
  }

  getModels(): ModelOption[] {
    return this.modelRuntime.getAvailableSnapshot().map((model) => ({
      provider: model.provider,
      modelId: model.id,
      label: model.name ?? model.id,
    }));
  }

  async prompt(params: {
    text: string;
    newSession?: boolean;
    activeSkills?: string[];
  }): Promise<void> {
    const isEmpty = this.session.sessionManager.getEntries().length === 0;
    if (params.newSession && !isEmpty) {
      this.pendingReason = 'new';
      await this.runtime.newSession();
    }
    if (params.newSession) {
      const name =
        params.text.slice(0, 30) + (params.text.length > 30 ? '…' : '');
      this.session.setSessionName(name || '新任务');
      if (this.session.sessionFile) {
        this.options.onSessionCreated?.(this.session.sessionFile);
      }
    }
    try {
      await this.session.prompt(params.text);
      const error = this.session.agent.state.errorMessage;
      if (error) throw new Error(error);
    } finally {
      this.bridge.flush();
      this.options.onTurnFinished?.();
    }
  }

  async abort(): Promise<void> {
    this.session.clearQueue();
    if (this.session.isStreaming) await this.session.abort();
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
  }

  async newSession(): Promise<void> {
    this.pendingReason = 'new';
    await this.runtime.newSession();
  }

  async switchSession(path: string): Promise<ParsedMessage[]> {
    if (!existsSync(path)) throw new Error(`Session file not found: ${path}`);
    this.pendingReason = 'switch';
    await this.runtime.switchSession(path, { cwdOverride: this.workspacePath });
    return readSessionMessages(path);
  }

  async fork(
    entryId: string,
    position?: 'before' | 'at',
  ): Promise<{ cancelled: boolean }> {
    this.pendingReason = 'fork';
    const result = await this.runtime.fork(
      entryId,
      position ? { position } : undefined,
    );
    return { cancelled: result.cancelled };
  }

  async listSessions(): Promise<SessionMeta[]> {
    return listSessions(this.workspacePath, this.resolveSessionsDir());
  }

  async deleteSession(path: string): Promise<void> {
    if (path === this.session.sessionFile) {
      this.pendingReason = 'new';
      await this.runtime.newSession();
    }
    deleteSessionFile(path);
  }

  renameSession(path: string, name: string): void {
    if (path === this.session.sessionFile) this.session.setSessionName(name);
  }

  async getMessages(path?: string): Promise<ParsedMessage[]> {
    return readSessionMessages(path ?? this.session.sessionFile ?? '');
  }

  async compact(instructions?: string): Promise<void> {
    await this.session.compact(instructions);
  }

  setModel(provider: string, modelId: string): Promise<void> {
    const model = this.modelRuntime
      .getAvailableSnapshot()
      .find((item) => item.provider === provider && item.id === modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    return this.session.setModel(model as never).then(() => {
      this.settingsManager.setDefaultModelAndProvider(provider, modelId);
      this.emitStatus();
    });
  }

  setThinkingLevel(level: string): void {
    this.session.setThinkingLevel(level as never);
    const model = this.session.model as
      | { provider: string; id: string }
      | undefined;
    if (model) {
      this.settingsManager.setModelThinkingLevel(
        model.provider,
        model.id,
        level as never,
      );
    }
    this.emitStatus();
  }

  cycleThinkingLevel(): string | undefined {
    const level = this.session.cycleThinkingLevel();
    const model = this.session.model as
      | { provider: string; id: string }
      | undefined;
    if (level && model) {
      this.settingsManager.setModelThinkingLevel(
        model.provider,
        model.id,
        level as never,
      );
    }
    this.emitStatus();
    return level;
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
    await this.rebuildForModelChange();
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.modelStore.deleteProvider(providerId);
    await this.rebuildForModelChange();
  }

  async saveModel(providerId: string, model: unknown): Promise<void> {
    await this.modelStore.saveModel(providerId, model as never);
    await this.rebuildForModelChange();
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    await this.modelStore.deleteModel(providerId, modelId);
    await this.rebuildForModelChange();
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
      // Provider 已完成 token 交换；先通过 pi 的凭据接口落盘。
      await this.modelRuntime.setRuntimeApiKey(providerId, input.accessToken);
      await this.modelRuntime.refresh({
        providers: [providerId],
        allowNetwork: true,
      });
      this.emitStatus();
      return;
    }
    throw new Error('OAuth 回调缺少 accessToken');
  }

  async logoutProvider(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId);
    await this.modelRuntime.refresh({ providers: [providerId] });
    this.emitStatus();
  }

  async loginProvider(input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  }): Promise<void> {
    if (input.type === 'api_key' && input.apiKey) {
      await this.modelRuntime.setRuntimeApiKey(input.providerId, input.apiKey);
      await this.modelRuntime.refresh({ providers: [input.providerId] });
      this.emitStatus();
      return;
    }
    await runProviderLogin(
      {
        runtime: () => this.modelRuntime,
        askDialog: (dialogType, fields) => {
          const host = this.dialogHost;
          if (!host) throw new Error('对话框宿主未接入');
          return host.ask(dialogType, fields) as Promise<
            string | boolean | undefined
          >;
        },
        dialogHost: () => this.dialogHost,
        notify: (message, level, source) =>
          this.options.ui?.onNotify(message, level, source),
        openExternal: this.options.openExternal,
        emitStatus: () => this.emitStatus(),
      },
      { providerId: input.providerId, type: 'oauth' },
    );
  }

  async rebuildForModelChange(): Promise<void> {
    const file = this.session.sessionFile;
    this.pendingReason = 'model-change';
    if (file && existsSync(file)) {
      await this.runtime.switchSession(file, {
        cwdOverride: this.workspacePath,
      });
    } else {
      await this.runtime.newSession();
    }
    this.emitStatus();
  }

  getLoadedResources(): LoadedResourcesView {
    return loadedResources(this.services.resourceLoader);
  }

  getCommands(): Array<{
    name: string;
    description?: string;
    source?: string;
  }> {
    const commands: Array<{
      name: string;
      description?: string;
      source?: string;
    }> = [];
    for (const extension of this.getLoadedResources().extensions) {
      for (const name of extension.commands) {
        commands.push({ name, source: extension.path });
      }
    }
    return commands;
  }

  async reloadResources(): Promise<void> {
    if (this.session.isStreaming) return;
    await this.session.reload();
    this.emitStatus();
  }

  /** 插件增删技能目录后重建会话运行时；保留当前会话文件。 */
  async rebuildForSkills(): Promise<void> {
    if (this.session.isStreaming) return;
    const file = this.session.sessionFile;
    this.pendingReason = 'skills';
    this.bridge.detach();
    await this.runtime.dispose();
    const workspaceId = workspaceIdOf(this.workspacePath);
    const sessionsDir = this.resolveSessionsDir();
    const sessionManager =
      file && existsSync(file)
        ? SessionManager.open(file, sessionsDir, this.workspacePath)
        : SessionManager.create(this.workspacePath, sessionsDir);
    this.runtime = await createAgentSessionRuntime(this.createFactory(), {
      cwd: this.workspacePath,
      agentDir: this.agentDir,
      sessionManager,
    });
    this.installRebindHooks();
    this.bridge.attach(this.runtime.session);
    await this.bindCurrentSessionExtensions();
    this.emitStatus();
  }

  async extendSkillPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.rebuildForSkills();
  }

  async setWorkspace(path: string): Promise<AgentSnapshot> {
    if (!existsSync(path)) throw new Error(`Directory not found: ${path}`);
    this.workspacePath = path;
    this.options.onWorkspaceChange?.(path);
    await this.rebuildForWorkspace();
    return this.getSnapshot();
  }

  async rebuildForWorkspace(): Promise<void> {
    this.pendingReason = 'workspace';
    this.bridge.detach();
    await this.runtime.dispose();
    const workspaceId = workspaceIdOf(this.workspacePath);
    this.settingsStorage = new AppSpaceSettingsStorage(
      join(this.options.storage.dataRoot, 'settings.json'),
      join(this.options.storage.workspaceBase(workspaceId), 'settings.json'),
    );
    const sessionManager = SessionManager.create(
      this.workspacePath,
      this.options.storage.sessionsDir(workspaceId),
    );
    this.runtime = await createAgentSessionRuntime(this.createFactory(), {
      cwd: this.workspacePath,
      agentDir: this.agentDir,
      sessionManager,
    });
    this.installRebindHooks();
    this.bridge.attach(this.runtime.session);
    this.emitStatus();
  }

  handleDialogResponse(
    response: import('../../../../shared/types.ts').UiDialogResponse,
  ): void {
    this.dialogHost?.respond(response);
  }

  private async bindCurrentSessionExtensions(): Promise<void> {
    const ui = this.options.ui;
    if (!ui) return;
    const session = this.session;
    this.dialogHost?.dispose();
    this.dialogHost = new DialogHost(session.sessionId, {
      onRequest: (request) => ui.onDialogRequest(request),
      onResolved: (id, reason) => ui.onDialogResolved(id, reason),
    });
    await session.bindExtensions({
      uiContext: makeUiContext({
        dialogs: this.dialogHost,
        onNotify: (message, level, source) =>
          ui.onNotify(message, level, source),
        onEditorText: (text, source, paste) => {
          this.editorText = paste ? `${this.editorText}${text}` : text;
          this.bridge.pushInternal({
            type: 'editor_text',
            text,
            source,
            ...(paste ? { paste: true } : {}),
          } as AppInternalEvent);
        },
        getEditorText: () => this.editorText,
        onStatus: (key, text) =>
          this.bridge.pushInternal({
            type: 'ui_status',
            key,
            text,
          } as AppInternalEvent),
        onWorking: (message) =>
          this.bridge.pushInternal({
            type: 'ui_working',
            message,
          } as AppInternalEvent),
        onWidget: (key, lines) =>
          this.bridge.pushInternal({
            type: 'ui_widget',
            key,
            lines,
          } as AppInternalEvent),
        onTitle: (title) =>
          this.bridge.pushInternal({
            type: 'ui_title',
            title,
          } as AppInternalEvent),
      }),
      mode: 'rpc' as never,
      onError: (error) => console.error('[agent] extension error', error),
    });
  }

  emitStatus(): void {
    this.bridge.pushInternal({
      type: 'agent_status_changed',
      status: this.getSnapshot(),
    } as AppInternalEvent);
  }

  dispose(): void {
    this.dialogHost?.dispose();
    this.dialogHost = null;
    this.bridge.dispose();
    void this.runtime.dispose();
  }

  private createFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager }) => {
      const workspaceId = workspaceIdOf(cwd);
      const storage = new AppSpaceSettingsStorage(
        join(this.options.storage.dataRoot, 'settings.json'),
        join(this.options.storage.workspaceBase(workspaceId), 'settings.json'),
      );
      this.settingsStorage = storage;
      const settingsManager = SettingsManager.fromStorage(storage, {
        projectTrusted: true,
      });
      const session = await WorkAgentSession.assemble({
        cwd,
        workspaceId,
        agentDir: this.agentDir,
        sessionManager,
        settingsManager,
        skills: this.skills,
        ...(this.options.extensionFactories
          ? { extensionFactories: this.options.extensionFactories }
          : {}),
        ...(this.options.additionalSkillPaths
          ? { additionalSkillPaths: this.options.additionalSkillPaths() }
          : {}),
        ...(this.options.skillOwner
          ? { skillOwner: this.options.skillOwner }
          : {}),
        ...(this.options.openExternal
          ? { openExternal: this.options.openExternal }
          : {}),
      });
      return {
        session: session.piSession,
        extensionsResult: session.extensionsResult,
        services: session.services,
        diagnostics: session.diagnostics,
      };
    };
  }

  private installRebindHooks(): void {
    this.runtime.setRebindSession(async (session) => {
      this.bridge.attach(session);
      await this.bindCurrentSessionExtensions();
      this.bridge.pushInternal({
        type: 'session_rebound',
        sessionFile: session.sessionFile ?? '',
        sessionId: session.sessionId,
        reason: this.pendingReason,
      } as AppInternalEvent);
    });
    this.runtime.setBeforeSessionInvalidate(() => {
      this.dialogHost?.dispose();
      this.dialogHost = null;
    });
  }
}

function workspaceIdOf(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12);
}
