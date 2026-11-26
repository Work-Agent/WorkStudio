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

/** 供应商可用的认证路线：OAuth 登录 / API Key 配置 / 仅环境变量。 */
export type ProviderAuthType = 'oauth' | 'api_key' | 'environment';

/** 授权页交回的凭证：类型由 SDK 定义（插件与宿主共用同一契约）。 */
export type { ProviderCredentialInput } from '@work-studio/sdk';

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
  /** 该供应商支持的认证路线（可配置的）。 */
  authTypes: ProviderAuthType[];
  /** 授权页地址（打开新标签用它；缺省由 baseUrl 推导）。 */
  loginUrl?: string;
  /** 当前生效的路线；未配置时缺省。 */
  authType?: ProviderAuthType;
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
  /** 数据根（可配置，见 architecture.md §2.6）。 */
  dataRoot: string;
  /** 根的来源：flag / env / pointer / portable / default。 */
  dataRootSource: string;
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
  sceneFile: string;
  appPath: string;
  /** 站点快照目录（落在用户工作区内，跟随内容）。 */
  sitesDir: string;
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
  /** pi JSONL 消息条目 id；用于从该消息 fork。 */
  entryId?: string;
  blocks: ParsedBlock[];
};

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
  /** 资源两级列表：当前展开的分组 id（null = 分组总览）。 */
  sidebarGroup: string | null;
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

// ── 弹窗菜单（原生 Menu.popup） ──

export interface PopupMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

/** Agent 状态投影（pi 快照的渲染层子集）。 */
export interface AgentStatus {
  configured: boolean;
  provider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  workspacePath?: string;
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
  | { type: 'editor_text'; text: string; source: string; paste?: boolean }
  | { type: 'ui_status'; key: string; text?: string }
  | { type: 'ui_widget'; key: string; lines?: string[] }
  | { type: 'ui_working'; message?: string }
  | { type: 'ui_title'; title: string }
  | { type: 'error'; message: string };

/** pi 官方事件族（渲染层消费子集，delta-only 线格式）。 */
export type PiSessionEvent =
  | { type: 'message_start'; message: { role: string; content?: unknown } }
  | {
      type: 'message_update';
      assistantMessageEvent: {
        type: string;
        delta?: string;
        content?: string;
        contentIndex?: number;
      };
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
// ─── 视图总线消息（主窗口监听 webview 上报） ─────────────────

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
  /** 自定义图标（favicon 格式，data: URL）。 */
  iconUrl?: string;
  /** 渲染器归属插件。 */
  owner?: string;
  /** 命中的 codec（资源页）。 */
  codec?: string;
}

/** 插件地址栏动作投影（构建期 / 插件声明）。 */
export interface ViewActionView {
  id: string;
  label: string;
  icon?: string;
  active?: boolean;
}

export interface ViewEntry {
  renderer?: RendererInfo;
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
  /** 文件已删除或重命名（标签显示删除线）。 */
  missing?: boolean;
  /** 未保存且外部内容已变化。 */
  conflict?: boolean;
  temporary?: boolean;
  interactiveElements?: boolean;
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
  /** 助手形态：dock 占据右侧，floating 使用浮动几何。 */
  assistantMode: 'dock' | 'floating';
  /** 助手是否显示（收起时 dock / floating 均隐藏）。 */
  assistantVisible: boolean;
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
  /** 非模态：不铺背板、不挡背后的页面（等待浏览器回调的粘贴框用它）。 */
  modal?: boolean;
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

// ─── 交互 ──────────────────────────────────────────────────

/** ws:interaction:update 载荷。 */
export interface InteractionUpdate {
  preview: InteractionPreview;
}
