/**
 * AgentHost —— pi SDK 的桌面封装（architecture.md §6.2.1）。
 *
 * 唯一持有 pi runtime 与 session 的模块；对外只暴露三面：
 *   命令（session/agent 域）、快照（AgentSnapshot）、事件（EventBridge 唯一出口）。
 * 装配范式严格对齐 pi 启动链（settings → services → session），harness 经
 * extensionFactories 装载（自有工具 + 官方内置扩展兼容）。
 */
import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, join } from 'path';
import {
  SessionManager,
  SettingsManager,
  createAgentSessionRuntime,
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
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
  UiDialogRequest,
  UiDialogResponse,
} from '../../shared/types';
import type { BrowserAutomationContract } from '../harness/browser-contract';
import type { Ura } from '../ura/facade';
import { AgentSession as WorkAgentSession } from './session';
import type { SkillsManager } from '../harness/skills';
import type { PluginHost } from '../plugins/host';
import { DialogHost, makeUiContext } from './ui-context';
import { EventBridge } from './event-bridge';
import { SettingsService } from './config-service';
import { modelCatalog, providerCatalog } from './model-catalog';
import { loadedResources } from './resources-view';
import { loginProvider as loginProviderWith } from './model-auth';
import { listSessions } from './session-list';
import { AppSpaceSettingsStorage } from './settings-storage';
import {
  deleteSessionFile,
  readSessionMessages,
  readSessionTokens,
} from './session-index';
import {
  getAgentDir,
  getSessionsDir,
  getWorkspaceBase,
  getWorkspaceId,
  registerWorkspace,
} from './workspace';
import { createLogger } from '../log';

const log = createLogger('agent');

export interface AgentHostDeps {
  ura: Ura;
  skills: SkillsManager;
  registry: PluginHost;
  getBrowserAutomation: () => BrowserAutomationContract | null;
  /** 事件帧出口（L3 → app:event 广播）。 */
  sendEvent: (frame: PiEventFrame) => void;
  /** 每轮结束（L3 广播 documents:changed 等）。 */
  onTurnFinished: () => void;
  /** 新会话落定（首条消息自动开标签；L3 写 openPaths/activePath）。 */
  onSessionCreated?: (path: string) => void;
  /** 工作区切换（L3 重绑资源 / ui-state / 浏览器策略）。 */
  onWorkspaceChange: (path: string) => void;
  /** 扩展 UI 出口。 */
  ui: {
    onDialogRequest: (req: UiDialogRequest) => void;
    onDialogResolved: (id: string, reason: string) => void;
    onNotify: (
      message: string,
      level: 'info' | 'warning' | 'error',
      source: string,
    ) => void;
  };
  /** MCP OAuth 等外部链接。 */
  openExternal?: (url: string) => void | Promise<void>;
}

export class AgentHost {
  readonly bridge: EventBridge;
  private runtime!: AgentSessionRuntime;
  private workspacePath!: string;
  private settingsStorage!: AppSpaceSettingsStorage;
  private dialogHost: DialogHost | null = null;
  private editorText = '';
  private pendingReason = 'replace';

  private constructor(
    private readonly deps: AgentHostDeps,
    private readonly agentDir: string,
  ) {
    this.bridge = new EventBridge((frame) => deps.sendEvent(frame));
  }

  /** bootstrap 早期 settings（sessionDir 解析需要；runtime 装配后指向 services 版本）。 */
  private sessionDirSettings: SettingsManager | null = null;

  /** 启动装配（pi 启动链的桌面形态；workspace 由 L3 解析后传入）。 */
  static async bootstrap(
    deps: AgentHostDeps,
    workspacePath: string,
  ): Promise<AgentHost> {
    process.env['PI_SKIP_VERSION_CHECK'] = '1';
    const agentDir = getAgentDir();
    mkdirSync(agentDir, { recursive: true });
    const host = new AgentHost(deps, agentDir);
    host.workspacePath = workspacePath;
    const wsId = registerWorkspace(workspacePath);
    host.settingsStorage = new AppSpaceSettingsStorage(
      join(agentDir, 'settings.json'),
      join(getWorkspaceBase(wsId), 'settings.json'),
    );
    host.sessionDirSettings = SettingsManager.fromStorage(
      host.settingsStorage,
      {
        projectTrusted: true,
      },
    );
    const sessionManager = SessionManager.create(
      workspacePath,
      host.resolveSessionsDir(),
    );
    host.runtime = await createAgentSessionRuntime(host.createFactory(), {
      cwd: workspacePath,
      agentDir,
      sessionManager,
    });
    host.installRebindHooks();
    host.bridge.attach(host.runtime.session);
    await host.bindCurrentSessionExtensions();
    return host;
  }

  // ─── 访问面 ─────────────────────────────────────────────

  get session(): AgentSession {
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

  get currentSeq(): number {
    return this.bridge.currentSeq;
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /** 会话落盘目录：settings.sessionDir（相对工作区解析）优先，否则 App 空间 ws 目录。 */
  resolveSessionsDir(): string {
    const configured = this.sessionDirSettings?.getSessionDir?.();
    if (configured) {
      return isAbsolute(configured)
        ? configured
        : join(this.workspacePath, configured);
    }
    return getSessionsDir(getWorkspaceId(this.workspacePath));
  }

  get settingsService(): SettingsService {
    return new SettingsService(this.settingsStorage);
  }

  // ─── runtime 工厂（pi 装配链） ───────────────────────────

  private createFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager }) => {
      const wsId = registerWorkspace(cwd);
      // project 层 settings 搬进 App 空间（与 sessions 同构，不污染用户项目目录）。
      const storage = new AppSpaceSettingsStorage(
        join(this.agentDir, 'settings.json'),
        join(getWorkspaceBase(wsId), 'settings.json'),
      );
      this.settingsStorage = storage;
      const settingsManager = SettingsManager.fromStorage(storage, {
        projectTrusted: true,
      });
      this.sessionDirSettings = settingsManager;

      const session = await WorkAgentSession.assemble({
        cwd,
        workspaceId: wsId,
        agentDir: this.agentDir,
        sessionManager,
        settingsManager,
        deps: {
          ura: this.deps.ura,
          skills: this.deps.skills,
          registry: this.deps.registry,
          getBrowserAutomation: this.deps.getBrowserAutomation,
          openExternal: this.deps.openExternal,
        },
      });

      return {
        session: session.piSession,
        extensionsResult: session.extensionsResult,
        services: session.services,
        diagnostics: session.diagnostics,
      };
    };
  }

  // ─── 换代协议 ───────────────────────────────────────────

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

  /** 扩展绑定（uiContext + mode rpc + 错误归因）；对话框宿主随会话换代。 */
  private async bindCurrentSessionExtensions(): Promise<void> {
    const session = this.runtime.session;
    this.dialogHost?.dispose();
    this.dialogHost = new DialogHost(session.sessionId, {
      onRequest: (req) => this.deps.ui.onDialogRequest(req),
      onResolved: (id, reason) => this.deps.ui.onDialogResolved(id, reason),
    });
    await session.bindExtensions({
      uiContext: makeUiContext({
        dialogs: this.dialogHost,
        onNotify: (message, level, source) =>
          this.deps.ui.onNotify(message, level, source),
        onEditorText: (text, source, paste) => {
          this.editorText = paste ? `${this.editorText}${text}` : text;
          this.pushInternal({
            type: 'editor_text',
            text,
            source,
            ...(paste ? { paste: true } : {}),
          });
        },
        getEditorText: () => this.editorText,
        onStatus: (key, text) =>
          this.pushInternal({ type: 'ui_status', key, text }),
        onWorking: (message) =>
          this.pushInternal({ type: 'ui_working', message }),
        onWidget: (key, lines) =>
          this.pushInternal({ type: 'ui_widget', key, lines }),
        onTitle: (title) => this.pushInternal({ type: 'ui_title', title }),
      }),
      mode: 'rpc' as never,
      onError: (err) => log.error('extension error', err),
    });
  }

  // ─── 快照 ───────────────────────────────────────────────

  getSnapshot(): AgentSnapshot {
    const s = this.session;
    const model = s.model as
      | { provider: string; id: string; name?: string }
      | undefined;
    // 未配置模型时 pi 回落 provider/id = "unknown" 的占位模型：不能当已配置。
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
    return this.modelRuntime.getAvailableSnapshot().map((m) => ({
      provider: m.provider,
      modelId: m.id,
      label: m.name ?? m.id,
    }));
  }

  // ─── 会话命令 ───────────────────────────────────────────

  async prompt(params: {
    text: string;
    newSession?: boolean;
    activeSkills?: string[];
  }): Promise<void> {
    if (params.activeSkills) this.deps.skills.setActive(params.activeSkills);
    const isEmpty = this.session.sessionManager.getEntries().length === 0;
    if (params.newSession && !isEmpty) {
      this.pendingReason = 'new';
      await this.runtime.newSession();
    }
    const session = this.session;
    if (params.newSession) {
      const name =
        params.text.slice(0, 30) + (params.text.length > 30 ? '…' : '') ||
        '新任务';
      session.setSessionName(name);
      this.bridge.pushInternal({
        type: 'session_created',
        sessionName: name,
        sessionPath: session.sessionFile ?? '',
      } as AppInternalEvent);
      if (session.sessionFile)
        this.deps.onSessionCreated?.(session.sessionFile);
    }
    try {
      await session.prompt(params.text);
      const err = session.agent.state.errorMessage;
      if (err) throw new Error(err);
    } catch (e) {
      this.bridge.pushInternal({
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      } as AppInternalEvent);
    } finally {
      this.deps.onTurnFinished();
    }
  }

  async abort(): Promise<void> {
    // 停止 = 终止执行 + 清空队列（否则队列残留继续消费，表现为「停止无效」）。
    this.session.clearQueue();
    if (this.session.isStreaming) await this.session.abort();
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
  }

  clearQueue(): void {
    this.session.clearQueue();
  }

  async newSession(): Promise<void> {
    this.pendingReason = 'new';
    await this.runtime.newSession();
  }

  async switchSession(path: string): Promise<{
    messages: ParsedMessage[];
    tokens: { input: number; output: number };
  }> {
    if (!existsSync(path)) throw new Error(`Session file not found: ${path}`);
    this.pendingReason = 'switch';
    await this.runtime.switchSession(path, { cwdOverride: this.workspacePath });
    return {
      messages: readSessionMessages(path),
      tokens: readSessionTokens(path),
    };
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
    if (path === this.session.sessionFile) {
      this.session.setSessionName(name);
    } else {
      SessionManager.open(
        path,
        undefined,
        this.workspacePath,
      ).appendSessionInfo(name);
    }
  }

  /** 历史消息（打开标签时懒加载）。 */
  async getMessages(path?: string): Promise<ParsedMessage[]> {
    const file = path ?? this.session.sessionFile ?? '';
    return readSessionMessages(file);
  }

  async compact(instructions?: string): Promise<void> {
    await this.session.compact(instructions);
  }

  setSteeringMode(mode: 'all' | 'one-at-a-time'): void {
    this.session.setSteeringMode(mode);
    this.emitStatus();
  }

  setFollowUpMode(mode: 'all' | 'one-at-a-time'): void {
    this.session.setFollowUpMode(mode);
    this.emitStatus();
  }

  setAutoCompaction(enabled: boolean): void {
    this.session.setAutoCompactionEnabled(enabled);
    this.emitStatus();
  }

  getCommands(): Array<{ name: string; description: string; source: string }> {
    try {
      return this.session.extensionRunner.getRegisteredCommands().map((c) => ({
        name: c.name,
        description: c.description ?? '',
        source: 'extension',
      }));
    } catch {
      return [];
    }
  }

  // ─── 模型 / 档位 ────────────────────────────────────────

  async setModel(provider: string, modelId: string): Promise<void> {
    const model = this.modelRuntime
      .getAvailableSnapshot()
      .find((m) => m.provider === provider && m.id === modelId);
    if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.session.setModel(model as never);
    this.settingsManager.setDefaultModelAndProvider(provider, modelId);
    this.emitStatus();
  }

  setThinkingLevel(level: string): void {
    const s = this.session;
    s.setThinkingLevel(level as never);
    const model = s.model as { provider: string; id: string } | undefined;
    if (model)
      this.settingsManager.setModelThinkingLevel(
        model.provider,
        model.id,
        level as never,
      );
    this.emitStatus();
  }

  cycleThinkingLevel(): string | undefined {
    const s = this.session;
    const level = s.cycleThinkingLevel();
    const model = s.model as { provider: string; id: string } | undefined;
    if (level && model)
      this.settingsManager.setModelThinkingLevel(
        model.provider,
        model.id,
        level as never,
      );
    this.emitStatus();
    return level;
  }

  async configure(input: {
    provider?: string;
    modelId?: string;
    apiKey?: string;
    thinkingLevel?: ThinkingLevel;
  }): Promise<AgentSnapshot> {
    if (input.apiKey && input.provider) {
      await this.modelRuntime.setRuntimeApiKey(input.provider, input.apiKey);
    }
    if (input.provider && input.modelId) {
      await this.setModel(input.provider, input.modelId);
    }
    if (input.thinkingLevel) this.setThinkingLevel(input.thinkingLevel);
    return this.getSnapshot();
  }

  async clearRuntimeKey(provider: string): Promise<void> {
    await this.modelRuntime.removeRuntimeApiKey(provider);
  }

  // ─── 供应商认证 / 目录（模型设置） ───────────────────────

  /** 供应商目录 + 凭证状态（凭证值不出主进程）。 */
  getProviderCatalog(customProviderIds: string[]): ProviderInfoView[] {
    return providerCatalog(this.modelRuntime, customProviderIds);
  }

  /** 模型目录（全部供应商；available = 供应商凭证已配置）。 */
  getModelCatalog(): ModelCatalogItem[] {
    return modelCatalog(this.modelRuntime);
  }

  /**
   * 供应商登录（api_key / oauth）。凭证经 pi 登录链写入 auth.json；
   * 交互步骤（密钥 / 验证码 / 选项）经浮层对话框完成，凭证值不回传渲染层。
   */
  async loginProvider(input: {
    providerId: string;
    type: 'api_key' | 'oauth';
    apiKey?: string;
  }): Promise<void> {
    await loginProviderWith(
      {
        runtime: () => this.modelRuntime,
        askDialog: (type, fields) => this.askDialog(type, fields),
        dialogHost: () => this.dialogHost,
        notify: (message, level, source) =>
          this.deps.ui.onNotify(message, level, source),
        openExternal: this.deps.openExternal,
        emitStatus: () => this.emitStatus(),
      },
      input,
    );
  }

  /** 删除已存凭证（环境变量 / models.json 中的 key 不受影响）。 */
  async logoutProvider(providerId: string): Promise<void> {
    await this.modelRuntime.logout(providerId);
    await this.modelRuntime.refresh({ providers: [providerId] });
    this.emitStatus();
  }

  /** 已加载资源投影（扩展 / 技能 / 提示词 / 主题 + 装载错误）。 */
  getLoadedResources(): LoadedResourcesView {
    return loadedResources(this.services.resourceLoader);
  }

  /** 资源热重载（安装 / 卸载 pi 包后调用；流式中不打断，等下一轮）。 */
  async reloadResources(): Promise<void> {
    if (this.session.isStreaming) {
      log.info('reload skipped (streaming)');
      return;
    }
    await this.session.reload();
    this.emitStatus();
  }

  /** 浮层对话框快捷入口（供应商登录交互用）。 */
  private async askDialog(
    dialogType: 'select' | 'input',
    fields: {
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      secret?: boolean;
    },
  ): Promise<string | boolean | undefined> {
    this.dialogHost ??= new DialogHost(this.session.sessionId, {
      onRequest: (req) => this.deps.ui.onDialogRequest(req),
      onResolved: (id, reason) => this.deps.ui.onDialogResolved(id, reason),
    });
    return this.dialogHost.ask(dialogType, fields);
  }

  // ─── 工作区 / 换代 ──────────────────────────────────────

  async setWorkspace(path: string): Promise<AgentSnapshot> {
    if (!existsSync(path)) throw new Error(`Directory not found: ${path}`);
    this.workspacePath = path;
    registerWorkspace(path);
    this.deps.onWorkspaceChange(path);
    await this.rebuildForWorkspace();
    return this.getSnapshot();
  }

  /** models.json 换代：同会话文件重开（services 重建 → 新 ModelRuntime 加载新目录）。 */
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

  /** 工作区切换：全新 runtime（cwd-bound services 以新 cwd 重建）。 */
  async rebuildForWorkspace(): Promise<void> {
    this.pendingReason = 'workspace';
    this.bridge.detach();
    await this.runtime.dispose();
    registerWorkspace(this.workspacePath);
    // sessionDir 可能刚变更：重建 settings 实体后再解析会话目录（不能复用旧实体）。
    this.sessionDirSettings = this.settingsStorage
      ? SettingsManager.fromStorage(this.settingsStorage, {
          projectTrusted: true,
        })
      : null;
    const sessionManager = SessionManager.create(
      this.workspacePath,
      this.resolveSessionsDir(),
    );
    this.runtime = await createAgentSessionRuntime(this.createFactory(), {
      cwd: this.workspacePath,
      agentDir: this.agentDir,
      sessionManager,
    });
    this.installRebindHooks();
    this.bridge.attach(this.runtime.session);
    await this.bindCurrentSessionExtensions();
    this.bridge.pushInternal({
      type: 'session_rebound',
      sessionFile: this.runtime.session.sessionFile ?? '',
      sessionId: this.runtime.session.sessionId,
      reason: 'workspace',
    } as AppInternalEvent);
    this.emitStatus();
  }

  // ─── 扩展 UI / 内部事件 ─────────────────────────────────

  handleDialogResponse(response: UiDialogResponse): void {
    this.dialogHost?.respond(response);
  }

  pushInternal(event: AppInternalEvent): void {
    this.bridge.pushInternal(event);
  }

  emitStatus(): void {
    try {
      this.bridge.pushInternal({
        type: 'agent_status_changed',
        status: this.getSnapshot(),
      } as never);
    } catch {
      /* runtime 重建中：状态下标不会变更，无需推 */
    }
  }

  dispose(): void {
    this.bridge.dispose();
    this.dialogHost?.dispose();
    void this.runtime.dispose();
  }
}
