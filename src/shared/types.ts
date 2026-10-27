import type { ViewActionView } from './ura';
// ─── 共享类型（主进程 + 渲染层 + preload 三方共用） ─────────────────
//
// 本文件是三端之间的唯一契约面：渲染层只依赖这些类型（不 import 任何进程内模块）。

// ─── 模型与配置 ────────────────────────────────────────────

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface ModelOption {
  provider: string;
  modelId: string;
  label: string;
}

/** 模型设置页视图（models.json 脱敏形态；apiKey 永不回传）。 */
export interface ModelConfigView {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
}

export interface ProviderConfigView {
  name?: string;
  baseUrl?: string;
  api?: string;
  models?: ModelConfigView[];
  [key: string]: unknown;
}

export interface ModelsConfigView {
  providers: Record<string, ProviderConfigView>;
}

/** 供应商认证状态（模型设置页；凭证值永不出现）。 */
export interface ProviderInfoView {
  id: string;
  name: string;
  /** 内置（pi 目录） / 自定义（models.json）。 */
  builtin: boolean;
  baseUrl?: string;
  configured: boolean;
  /** 配置来源：stored / runtime / environment / models_json_key… */
  authSource?: string;
  authLabel?: string;
  hasApiKeyAuth: boolean;
  hasOAuthAuth: boolean;
  /** 可交互登录（apiKey.login / oauth.login 存在）。 */
  canApiKeyLogin: boolean;
  canOAuthLogin: boolean;
  modelCount: number;
  availableModelCount: number;
}

/** 模型目录条目（模型设置页；来源于 pi 组合后的目录）。 */
export interface ModelCatalogItem {
  provider: string;
  modelId: string;
  label: string;
  reasoning: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** 供应商已配置凭证（可选中为默认模型）。 */
  available: boolean;
}

/** 存储与数据设置页视图（路径全部为绝对路径；凭证文件不含内容）。 */
export interface StorageView {
  workspacePath: string;
  workspaceId: string;
  agentDir: string;
  modelsJson: string;
  authJson: string;
  globalSettings: string;
  workspaceSettings: string;
  sessionsDir: string;
  defaultSessionsDir: string;
  /** settings.json 里显式配置的 sessionDir（null = 未配置）。 */
  sessionsDirConfigured: string | null;
  uiStateFile: string;
  resourcesDir: string;
  pluginsDirs: string[];
  bootLog: string;
  versions: {
    app: string;
    electron: string;
    chrome: string;
    node: string;
  };
}

/** 已加载资源投影（安装 / 卸载 pi 包后的「已加载」视图）。 */
export interface LoadedResourcesView {
  extensions: Array<{
    path: string;
    hidden: boolean;
    tools: string[];
    commands: string[];
  }>;
  skills: Array<{ name: string; description: string; path: string }>;
  prompts: Array<{ name: string; path: string }>;
  themes: Array<{ name: string; path: string }>;
  errors: Array<{ path: string; message: string }>;
}

/** 工作区清单项（工作区设置页）。 */
export interface WorkspaceInfo {
  path: string;
  name: string;
  wsId: string;
  createdAt: number;
  lastOpenedAt: number;
  current: boolean;
  exists: boolean;
}

export interface AgentStatus {
  configured: boolean;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  workspacePath?: string;
}

export interface AgentConfigureInput {
  provider?: string;
  modelId?: string;
  apiKey?: string;
  thinkingLevel?: ThinkingLevel;
  workspacePath?: string;
}

// ─── 会话 ─────────────────────────────────────────────────

/** Session 元数据（来自会话索引 / JSONL 落盘）。 */
export type SessionMeta = {
  path: string;
  name: string;
  createdAt: number;
  /** 最后一条助手消息的文本预览（截断）。 */
  preview?: string;
  /** token 统计（JSONL 累加；打开列表时不要求）。 */
  tokens?: { input: number; output: number };
  /** 消息条数（SessionManager 列表元数据）。 */
  messageCount?: number;
};

/** 从主进程返回的已解析历史消息内容块。 */
export type ParsedBlock =
  | { type: 'thinking'; text: string }
  | {
      type: 'tool';
      toolCallId: string;
      toolName: string;
      args: unknown;
      result: string;
    }
  | { type: 'text'; text: string };

/** 从主进程返回的已解析历史消息。 */
export type ParsedMessage = {
  role: 'user' | 'assistant';
  blocks: ParsedBlock[];
};

// ─── URA 统一资源访问器 ────────────────────────────────────

/** 资源三分法：content 全文可注入 / data 仅 schema 注入 / snapshot 页面状态存证。 */
export type UraType = 'content' | 'data' | 'snapshot';

/** 数据文档的 schema 描述（data 轨唯一可注入的数据形态）。 */
export interface UraSchema {
  label: string;
  fields: Array<{
    name: string;
    type: string;
    description?: string;
    required?: boolean;
  }>;
  states?: string[];
  relations?: Array<{ target: string; description: string }>;
}

/** URA 分组（同 source 内的二级分组）——web source 的「域 = 分组」即此类。 */
export interface UraGroup {
  /** 分组 id（source 命名空间内稳定，web = 域名，如 github.com）。 */
  id: string;
  /** 分组标题（web = 站点主标题优先，回退域名）。 */
  title: string;
  /** 分组图标（favicon data-url；可缺省 → 壳层回退默认图标）。 */
  icon?: string;
}

/** 分组视图（侧边栏分组行 / 域名列表的数据面）。 */
export interface UraGroupInfo extends UraGroup {
  source: string;
  sourceLabel: string;
  count: number;
  updatedAt: number;
}

/** 统一资源元数据：侧边栏 / 文档路由的通用模型。 */
export interface DocumentMeta {
  /** 唯一 id（资源地址的稳定键，对渲染层不透明）。 */
  id: string;
  /** 标题（文件名，tabs / 侧边栏短标题）。 */
  title: string;
  /** 命名空间内相对地址（资源定位，如 src/main/index.ts）。 */
  path?: string;
  /** 路径行地址：本地文档 = 工作区相对路径；应用内资源 = app:// scheme。 */
  url?: string;
  /** 文件类型（扩展名，不含点，小写）→ 决定用哪个扩展视图渲染。 */
  ext: string;
  /** 三轨类别。 */
  type: UraType;
  /** 来源 source id → 决定侧边栏分组。 */
  source: string;
  /** 来源展示名（如「本地文档」「业务数据」）。 */
  sourceLabel: string;
  /** 所属分组（无分组 = undefined；图标经 documents_groups 单独下发）。 */
  group?: UraGroup;
  createdAt: number;
  updatedAt?: number;
  size?: number;
  description?: string;
  /** data 类资源的 schema。 */
  schema?: UraSchema;
}

/** 文档读取结果（content 全文 / data 为 schema 描述）。 */
export interface DocumentContent {
  content: string;
  ext: string;
  type: UraType;
  size?: number;
}

/** URA 搜索结果。 */
export interface UraSearchResult {
  title: string;
  type: UraType;
  source: string;
  score: number;
  snippet: string;
}

// ─── 插件 ─────────────────────────────────────────────────

/** Skill 声明。 */
export interface SkillSpec {
  name: string;
  path: string;
}

/** 工具声明（四类贡献点之一：操作 tool）。 */
export interface ToolSpec {
  name: string;
  handler: string;
}

/** 扩展页面声明。 */
export interface ExtensionSpec {
  id: string;
  label: string;
  src: string;
  /** 匹配的文件扩展名列表（不含点，小写）。 */
  fileExtensions: string[];
  /** 壳层动作贡献（声明式）：TitleBar 地址栏动作区按激活实例类型追加的按钮 id。 */
  titlebarActions?: string[];
}

/** 插件配置页声明（manifest.config，渲染为扩展视图）。 */
export interface PluginConfigSpec {
  id: string;
  label: string;
  src: string;
}

/** 插件清单（manifest.json）。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  skills?: SkillSpec[];
  extensions?: ExtensionSpec[];
  tools?: ToolSpec[];
  config?: PluginConfigSpec;
}

/** 扩展定义（运行时展开，含所属插件）。 */
export interface ExtensionDef {
  id: string;
  label: string;
  extensions: string[];
  src: string;
  pluginId: string;
  /** 壳层动作贡献（声明式，源自 manifest extensions[].titlebarActions）。 */
  titlebarActions?: string[];
  /** 兜底渲染器（无扩展名匹配时使用）。 */
  default?: boolean;
}

/** 扩展视图实例的运行时元数据。 */
export interface ExtensionInstance {
  instanceId: string;
  extensionId: string;
  label: string;
  url: string;
  /** 关联的文档 id，无绑定时为 null。 */
  documentId: string | null;
  visible: boolean;
  /** 当前原生视图矩形（窗口坐标）；渲染层尚未丈量时为全零 —— 全零 = 不显示。 */
  bounds: { x: number; y: number; width: number; height: number };
  pluginId: string;
  /** webview 已报告 data:loaded（渲染层重载后可从主进程恢复，避免 spinner 永挂）。 */
  loaded: boolean;
  /** raw 网页视图（browser 插件面板：加载任意 URL，非扩展页面）。 */
  raw: boolean;
  /** raw 视图：可交互元素（ref 标记 + overlay）是否上屏；导航后自动复位 false。 */
  interactiveElements?: boolean;
  /** raw 视图且域名不在名单内 = 临时网页（不落盘，侧边栏「临时网页」分组跟随标签页）。 */
  temporary?: boolean;
}

/** 插件运行时信息（供 UI 展示）。 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  builtin: boolean;
  /** 自定义图标（favicon 格式，app://asset/...）。 */
  iconUrl?: string;
  extensionCount: number;
  skillCount: number;
  /** 工具贡献点数。 */
  toolCount: number;
  hasHome: boolean;
  /** 是否声明了配置页。 */
  hasConfig: boolean;
  /** 安装来源（zip / 本地路径 / 内置）。 */
  source?: string;
  /** zip 完整性哈希。 */
  hash?: string;
  /** 插件 API 版本。 */
  apiVersion?: number;
}

/** Skill 信息（供 UI 选择器 / 技能设置页展示）。 */
export interface SkillInfo {
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
  /** SKILL.md 绝对路径（展示 / 打开用）。 */
  path?: string;
  /** 装载作用域：user / project / temporary / builtin… */
  scope?: string;
  /** 来源标识（settings / package / builtin…）。 */
  source?: string;
  /** 仅手动调用（不注入提示词）。 */
  manualOnly?: boolean;
}

/** 技能视图（设置页：清单 + 装载诊断 + 当前启用集合）。 */
export interface SkillViewResult {
  skills: SkillInfo[];
  diagnostics: Array<{ type: string; message: string; path?: string }>;
  /** 当前启用集合（空 = 全量注入，pi 默认）。 */
  active: string[];
}

// ─── 用户操作状态（UiState，主进程 ui-state.json 持久化） ─────

export interface UiState {
  /** Schema 版本号（结构变更时递增，主进程 migrate）。 */
  __version__: number;
  /** 主题模式。 */
  theme: 'light' | 'dark';
  /** 右侧 AI 对话面板是否显示。 */
  aiOpen: boolean;
  /** AI 面板浮动形态：false = 停靠右栏；true = 独立浮层（可拖拽/缩放，仍可收起）。 */
  aiFloating: boolean;
  /** 左栏形态。 */
  sidebarView:
    | 'main'
    | 'sessions'
    | 'docs'
    | 'data'
    | 'web'
    | 'plugins'
    | 'settings'
    | 'find';
  /** web 二级列表当前选中的域分组（sidebarView='web' 时生效；null = 未选）。 */
  sidebarDomain?: string | null;
  /** 左栏 Sidebar 是否收起（收起 = 固定 56px 图标列，非整栏隐藏）。 */
  sidebarCollapsed: boolean;
  /** 资源面板是否收起。 */
  panelCollapsed: boolean;
  /** 输入框展开态。 */
  inputExpanded: boolean;
  /** 选中的技能列表（随 prompt 提交）。 */
  selectedSkills: string[];
  /** 三栏布局宽度（左/右栏；中栏弹性）——拖拽松手提交，重启恢复。 */
  paneWidths: { left: number; right: number };
  /** 当前活跃会话（null = 新任务态）。 */
  activePath: string | null;
  /** 已打开为标签的会话（工作现场恢复；与全部会话区分——关闭 ≠ 删除）。 */
  openPaths: string[];
  /** 资源面板打开集合的持久化键（order / pinned / activeKey；实例不落盘）。 */
  openTabs?: {
    order: string[];
    pinned: string[];
    activeKey: string | null;
  };
}

// ─── IPC 接口（preload 暴露给渲染层） ───────────────────────

export interface WorkAPI {
  // ── uiState:* —— 用户操作状态 ──
  uiState: {
    get(): Promise<UiState>;
    set(patch: Partial<UiState>): Promise<UiState>;
    onChanged(cb: (state: UiState) => void): () => void;
  };

  // ── agent:* —— AI 运行配置 ──
  status: () => Promise<AgentStatus>;
  models: () => Promise<ModelOption[]>;
  configure: (input: AgentConfigureInput) => Promise<AgentStatus>;
  setWorkspace: (path: string) => Promise<AgentStatus>;
  pickWorkspace: () => Promise<string | null>;

  // ── documents:* —— URA 资源 ──
  documents: {
    list: () => Promise<DocumentMeta[]>;
    groups: () => Promise<UraGroupInfo[]>;
    open: (
      docId: string,
    ) => Promise<{ content: DocumentContent; meta: DocumentMeta } | null>;
    update: (docId: string, content: string) => Promise<DocumentMeta | null>;
    search: (query: string) => Promise<UraSearchResult[]>;
    onRefresh: (cb: () => void) => () => void;
  };

  // ── plugins:* / skills:* —— 插件与技能清单 ──
  plugins: {
    list: () => Promise<PluginInfo[]>;
  };
  skills: {
    list: () => Promise<SkillInfo[]>;
  };

  // ── ext:* —— 视图总线（ExtensionViewHost 桥接） ──
  extensions: {
    definitions: () => Promise<ExtensionDef[]>;
    getOrCreate: (
      extensionId: string,
      opts?: {
        documentId?: string;
        theme?: string;
        label?: string;
        url?: string;
        raw?: boolean;
      },
    ) => Promise<string>;
    destroy: (instanceId: string) => Promise<void>;
    setActive: (instanceId: string | null) => Promise<void>;
    /** 重载视图（真实 reload：webContents.reload + 就绪态复位 + 内容重发链）。 */
    reload: (instanceId: string) => Promise<void>;
    list: () => Promise<ExtensionInstance[]>;
    syncBounds: (
      instanceId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => Promise<void>;
    sendToView: (
      instanceId: string,
      channel: string,
      payload: unknown,
    ) => Promise<void>;
    broadcast: (channel: string, payload: unknown) => Promise<void>;
    /** raw 网页视图导航。 */
    navigate: (instanceId: string, url: string) => Promise<void>;
    goBack: (instanceId: string) => Promise<void>;
    goForward: (instanceId: string) => Promise<void>;
    /** 可交互元素（ref 标记 + overlay）显隐；返回生效后的状态。 */
    setInteractiveElements: (
      instanceId: string,
      on: boolean,
    ) => Promise<boolean>;
  };

  // ── browser:* —— 浏览器自动化反馈通道 ──
  browser: {
    /** overlay 标签点击回填：订阅后用户点页面内 ref 标签 → 输入框追加 @ref。 */
    onRefClick: (cb: (ref: string) => void) => () => void;
  };
}

// ── 弹窗菜单（原生 Menu.popup；mock 阶段以 DOM 浮层等价物实现同协议） ──

export interface PopupMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface PopupSelectEvent {
  /** 调用方标识（多菜单源共存时路由，如 'tabs'）。 */
  source: string;
  actionId: string;
}

export interface PopupMenuAPI {
  show: (input: { source: string; items: PopupMenuItem[] }) => Promise<void>;
  onSelect: (cb: (e: PopupSelectEvent) => void) => () => void;
  close: () => Promise<void>;
  count: () => Promise<number>;
}

// ─── pi 事件流（渲染层消费子集） ───────────────────────────

/** 应用层内部事件族（pi 之上唯一的自有扩展）。 */
export type AppInternalEvent =
  | { type: 'session_created'; sessionName: string; sessionPath: string }
  | {
      type: 'session_rebound';
      sessionFile: string;
      sessionId: string;
      reason: string;
    }
  /** 运行配置变更（模型/工作区/思考档位/目录重建）→ 配置域投影收敛。 */
  | { type: 'agent_status_changed'; status: AgentStatus }
  | { type: 'error'; message: string };

/** pi 官方事件族（渲染层消费子集，delta-only 线格式）。 */
export type PiSessionEvent =
  | { type: 'message_start'; message: { role: string; content?: unknown } }
  | {
      type: 'message_update';
      assistantMessageEvent: { type: string; delta?: string };
    }
  | { type: 'message_end'; message: { role: string; content?: unknown } }
  | {
      type: 'tool_execution_start';
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      isError: boolean;
      result: unknown;
    }
  | { type: 'agent_settled' }
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | AppInternalEvent;

/** pi:event 帧：seq 单调递增，渲染层检测缺口 → pi:sync 快照重建。 */
export interface PiEventFrame {
  seq: number;
  event: PiSessionEvent;
}

/** pi:cmd:invoke 响应（结构化）。 */
export type PiCommandResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** get_state 返回（渲染层消费子集）。 */
export interface PiSessionState {
  model: { provider: string; id: string; name: string } | null;
  thinkingLevel: ThinkingLevel | null;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
  cwd: string;
}

/** pi:sync 握手结果。 */
export interface PiSyncResult {
  state: PiSessionState;
  seq: number;
}

/** preload piBridge 面向渲染层的类型（window.piAPI）。 */
export interface PiBridgeAPI {
  cmd: {
    invoke: <T = unknown>(
      command: string,
      params?: unknown,
    ) => Promise<PiCommandResponse<T>>;
  };
  onEvent: (cb: (frame: PiEventFrame) => void) => () => void;
  sync: () => Promise<PiSyncResult>;
  onUIRequest: (cb: (req: Record<string, unknown>) => void) => () => void;
  uiRespond: (resp: {
    id: string;
    ok: boolean;
    value?: unknown;
    reason?: string;
  }) => Promise<boolean>;
  pushEditorState: (text: string) => void;
}

// ─── 视图总线消息（主窗口监听 webview 上报） ─────────────────

export interface BusMessage {
  channel: string;
  payload: unknown;
  fromInstanceId: string | null;
}

export interface ElectronAPI {
  platform: string;
  versions?: Record<string, string>;
  openPath: (path: string) => Promise<string | null>;
}

// ═══════════════════════════════════════════════════════════
// 主进程新契约（README.md / architecture.md）
// ═══════════════════════════════════════════════════════════

// ─── Agent 快照与命令信封 ──────────────────────────────────

/** AgentHost 快照（app.sync 的 session 切片与 agent.status 共用）。 */
export interface AgentSnapshot {
  configured: boolean;
  provider?: string;
  modelId?: string;
  modelName?: string;
  thinkingLevel: ThinkingLevel | null;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  sessionFile: string | null;
  sessionId: string | null;
  sessionName: string | null;
  messageCount: number;
  pendingMessageCount: number;
  cwd: string;
  workspacePath: string;
}

/** 命令响应信封（ok:false 带错误码）。 */
export type CommandResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

// ─── 视图（集合 + 几何） ────────────────────────────────────

export type ViewState =
  | 'dormant'
  | 'creating'
  | 'loading'
  | 'ready'
  | 'contentDelivered'
  | 'reloading'
  | 'error'
  | 'destroyed';

export type ViewType = 'settings' | 'extension' | 'browser';

/** 视图投影（渲染层唯一数据面）。 */
/** 激活视图的渲染器（地址栏图标与动作作用域）。 */
export interface RendererInfo {
  /** surface / 渲染器 id（资源页）或插件 id（插件页）。 */
  id: string;
  label?: string;
  /** 图标语义名（壳层映射）。 */
  icon?: string;
  /** 自定义图标（favicon 格式，app://asset/...）。 */
  iconUrl?: string;
  /** 渲染器归属插件。 */
  owner?: string;
  /** 命中的 codec（资源页）。 */
  codec?: string;
}

export interface ViewEntry {
  id: string;
  tabKey: string;
  type: ViewType;
  extensionId: string;
  title: string;
  url: string;
  state: ViewState;
  /** 是否当前激活项（集合语义的投影；渲染层据此渲染激活态）。 */
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  temporary?: boolean;
  interactiveElements?: boolean;
  renderer?: RendererInfo;
  document?: DocumentMeta;
  plugin?: PluginInfo;
  /** 声明式标题栏动作 id（manifest 声明；主窗口按语义渲染按钮）。 */
  titlebarActions?: string[];
  /** 插件注册的地址栏动作（URA 视图动作）。 */
  actions?: ViewActionView[];
  /** 声明式动作状态（视图页 actionState 上报；如 layout-switch / toggle-wrap / toggle-scripts）。 */
  actionStates?: Record<string, string>;
  layout?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 布局引擎输出（DOM 条带与原生 bounds 共用）。 */
export interface LayoutSnapshot {
  window: { width: number; height: number };
  titlebar: Rect;
  workbench: Rect;
  sidebar: Rect;
  resourcePane: Rect;
  tabbar: Rect;
  resourceContent: Rect;
  assistantDock: Rect;
  assistantFloating: Rect;
  overlay: Rect;
}

/** 交互预览（主进程 → 渲染层；渲染层只渲染不计算）。 */
export interface InteractionPreview {
  type: InteractionType;
  /** pane-resize 的哪一侧。 */
  side?: 'left' | 'right';
  paneWidths?: { left: number; right: number };
  sidebarCollapsed?: boolean;
  floating?: Rect | null;
  /** tab-reorder：指针窗口内 x（渲染层据此算插入位并画标记）。 */
  cursorX?: number;
  tabKey?: string;
}

export type InteractionType =
  | 'pane-resize'
  | 'view-move'
  | 'view-resize'
  | 'tab-reorder';

/** 缩放方向（view-resize；缺省 = 右下角 'se'）。 */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface InteractionBeginInput {
  type: InteractionType;
  /** pane-resize: 'left' | 'right'；view-*: 'assistant'；tab-reorder: tabKey。 */
  target: string;
  /** view-resize 的缩放方向（八向；缺省 'se'）。 */
  direction?: ResizeDirection;
  anchor: { x: number; y: number };
}

/** Shell 快照（主进程布局 / 助手几何的构建中间态）。 */
export interface ShellSnapshot {
  ui: UiState;
  layout: LayoutSnapshot;
  /** 运行期浮动助手几何（null = 未设置 → 使用默认位置）。 */
  floating: Rect | null;
  preview: InteractionPreview | null;
}

// ─── 扩展 UI（ws:ui） ──────────────────────────────────────

export type UiDialogType = 'select' | 'confirm' | 'input' | 'editor';

export interface UiDialogRequest {
  type: 'dialog';
  id: string;
  dialogType: UiDialogType;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  /** 密文输入（凭证类）。 */
  secret?: boolean;
  timeoutMs?: number;
}

export interface UiDialogResponse {
  id: string;
  cancelled?: boolean;
  value?: string;
  confirmed?: boolean;
}

export interface UiNotifyMessage {
  type: 'notify';
  id: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  source?: string;
}

export type UiRequest = UiDialogRequest | UiNotifyMessage;

// ─── 交互 ──────────────────────────────────────────────────

/** ws:interaction:update 载荷。 */
export interface InteractionUpdate {
  preview: InteractionPreview;
}
