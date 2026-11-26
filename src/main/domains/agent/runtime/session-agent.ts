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
  ProviderCredentialInput,
  ProviderInfoView,
  SessionMeta,
  ThinkingLevel,
} from '../../../../shared/types.ts';
import { EventBridge } from './event-bridge.ts';
import { SettingsService } from './config-service.ts';
import { loadedResources } from './resources-view.ts';
import { listSessions } from './session-list.ts';
import { AppSpaceSettingsStorage } from './settings-storage.ts';
import { readSessionMessages, deleteSessionFile } from './session-index.ts';
import { AgentSession as WorkAgentSession } from './session.ts';
import type { ResourceRoot } from '../../../transport/resource.ts';
import { DialogHost, makeUiContext } from './ui-context.ts';
import type { AgentApp } from './agent-app.ts';

export interface SessionAgentOptions {
  /** App 级共享服务（模型、凭证、设置、技能、扩展工厂）。 */
  app: AgentApp;
  storage: StorageLayout;
  /** 工作区目录（pi 的 cwd）。 */
  workspacePath: string;
  /** 注册表里的工作区 id；缺省按 path 派生（仅兼容旧调用）。 */
  workspaceId?: string;
  /** 打开的会话文件；缺省新建会话。 */
  sessionFile?: string;
  /** 草稿会话的稳定标识（还没有会话文件时用作地址键）。 */
  draftKey?: string;
  sendEvent?: (frame: PiEventFrame) => void;
  onTurnFinished?: () => void;
  onSessionCreated?: (path: string) => void;
  /** 会话创建时生成资源地图用的资源根。 */
  resourceRoots?: () => readonly ResourceRoot[];
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

export class SessionAgent {
  readonly bridge: EventBridge;
  private runtime!: AgentSessionRuntime;
  private workspacePath: string;
  private settingsStorage!: AppSpaceSettingsStorage;
  private readonly app: AgentApp;
  private pendingReason = 'replace';
  private dialogHost: DialogHost | null = null;
  private editorText = '';

  private constructor(private readonly options: SessionAgentOptions) {
    this.workspacePath = options.workspacePath;
    this.app = options.app;
    this.bridge = new EventBridge((frame) => options.sendEvent?.(frame));
  }

  static async bootstrap(options: SessionAgentOptions): Promise<SessionAgent> {
    process.env['PI_SKIP_VERSION_CHECK'] = '1';
    mkdirSync(options.storage.dataRoot, { recursive: true });
    const host = new SessionAgent(options);
    const workspaceId =
      options.workspaceId ?? workspaceIdOf(options.workspacePath);
    host.settingsStorage = new AppSpaceSettingsStorage(
      join(options.storage.dataRoot, 'settings.json'),
      join(options.storage.workspaceBase(workspaceId), 'settings.json'),
    );
    const sessionsDir = options.storage.sessionsDir(workspaceId);
    const sessionManager =
      options.sessionFile && existsSync(options.sessionFile)
        ? SessionManager.open(
            options.sessionFile,
            sessionsDir,
            options.workspacePath,
          )
        : SessionManager.create(options.workspacePath, sessionsDir);
    host.runtime = await createAgentSessionRuntime(host.createFactory(), {
      cwd: options.workspacePath,
      agentDir: options.app.agentDir,
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
    return this.app.modelRuntime;
  }

  get settingsManager(): SettingsManager {
    return this.runtime.services.settingsManager;
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  get workspaceId(): string {
    return this.options.workspaceId ?? workspaceIdOf(this.workspacePath);
  }

  /** 会话地址键：URL 编码的会话文件路径，或草稿 id。 */
  get sessionKey(): string {
    const file = this.session.sessionFile;
    if (file) return encodeURIComponent(file);
    return this.options.draftKey ?? `draft-${this.session.sessionId}`;
  }

  skillsRef() {
    return this.app.skills;
  }

  resolveSessionsDir(): string {
    const configured = this.settingsManager.getSessionDir?.();
    if (configured) {
      return isAbsolute(configured)
        ? configured
        : join(this.workspacePath, configured);
    }
    return this.app.storage.sessionsDir(this.workspaceId);
  }

  get settingsService(): SettingsService {
    return this.app.settingsServiceFor(this.workspaceId);
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

  async refreshProviderModels(providerId: string): Promise<number> {
    return this.app.refreshProviderModels(providerId);
  }

  async loginViaPage(providerId: string): Promise<void> {
    await this.app.loginViaPage(providerId);
    this.emitStatus();
  }

  getProviderCatalog(customProviderIds: string[]): ProviderInfoView[] {
    return this.app.getProviderCatalog(customProviderIds);
  }

  getModelCatalog(): ModelCatalogItem[] {
    return this.app.getModelCatalog();
  }

  getModelsView(): unknown {
    return this.app.getModelsView();
  }

  getModels(): ModelOption[] {
    return this.app.models();
  }

  async saveProvider(providerId: string, config: unknown): Promise<void> {
    await this.app.saveProvider(providerId, config);
  }

  async deleteProvider(providerId: string): Promise<void> {
    await this.app.deleteProvider(providerId);
  }

  async saveModel(providerId: string, model: unknown): Promise<void> {
    await this.app.saveModel(providerId, model);
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    await this.app.deleteModel(providerId, modelId);
  }

  /** 授权页交回凭证：一步写入，不经过渲染层。 */
  async applyCredential(
    providerId: string,
    input: ProviderCredentialInput,
  ): Promise<void> {
    await this.app.applyCredential(providerId, input);
    this.emitStatus();
  }

  async logoutProvider(providerId: string): Promise<void> {
    await this.app.logoutProvider(providerId);
    this.emitStatus();
  }

  async loginProvider(input: { providerId: string }): Promise<void> {
    await this.app.loginProvider(input, {
      askDialog: (dialogType, fields, opts) => {
        const host = this.dialogHost;
        if (!host) throw new Error('对话框宿主未接入');
        return host.ask(dialogType, fields as never, opts as never) as Promise<
          string | boolean | undefined
        >;
      },
      dialogHost: () => this.dialogHost,
      notify: (message, level) =>
        this.options.ui?.onNotify(message, level, 'provider'),
      emitStatus: () => this.emitStatus(),
    });
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
    const sessionsDir = this.resolveSessionsDir();
    const sessionManager =
      file && existsSync(file)
        ? SessionManager.open(file, sessionsDir, this.workspacePath)
        : SessionManager.create(this.workspacePath, sessionsDir);
    this.runtime = await createAgentSessionRuntime(this.createFactory(), {
      cwd: this.workspacePath,
      agentDir: this.app.agentDir,
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
      const workspaceId = this.options.workspaceId ?? workspaceIdOf(cwd);
      const settingsManager = this.app.settingsManagerFor(workspaceId);
      const extensionFactories = this.app.extensionFactories;
      const additionalSkillPaths = this.app.additionalSkillPaths();
      const session = await WorkAgentSession.assemble({
        cwd,
        workspaceId,
        agentDir: this.app.agentDir,
        modelRuntime: this.app.modelRuntime,
        sessionManager,
        settingsManager,
        skills: this.app.skills,
        ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
        ...(additionalSkillPaths.length > 0 ? { additionalSkillPaths } : {}),
        resourceRoots: this.options.resourceRoots?.() ?? [],
        skillOwner: (source) => this.app.skillOwner(source),
        openUrl: (url) => this.app.openUrl(url),
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
