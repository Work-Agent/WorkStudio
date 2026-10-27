# 架构设计

> 系统化设计：主进程由 AppHost 统一管理 App / Workspace 两级作用域，Session 交给 pi；资源、页面、列表、视图按作用域加载；渲染层只消费 AppSnapshot，所有写经 AppCommand。

## 一、作用域与分层

### 1.1 主进程结构

```
┌─ 渲染层 ────────────────────────────────────────────────────────────┐
│ 壳层 DOM · 列表宿主 · 系统页面                                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ AppSnapshot / AppCommand / AppEvent
┌─ 主进程 AppHost ─────────────▼──────────────────────────────────────┐
│ AppScope（应用级）                                                   │
│ 模型目录 · 凭证 · 插件安装 · Pi 包 · 全局设置 · 系统视图               │
│ 工作区列表 · 当前工作区                                               │
├──────────────────────────────────────────────────────────────────────┤
│ WorkspaceManager                                                     │
│  └─ WorkspaceScope（工作区级）                                       │
│     URA · 列表 · 视图集合 · UI 现场 · 页面/写会话 · 会话索引 · 浏览器   │
├──────────────────────────────────────────────────────────────────────┤
│ SessionAdapter（会话级，薄适配）                                     │
│ 当前 pi session · 事件桥 · 扩展 UI 上下文                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 官方扩展点
                            pi SDK
```

- **AppHost 是唯一组合根**：创建作用域、装配服务、提供快照 / 命令 / 事件出口。
- **AppScope 管可跨工作区的东西**：应用级状态与系统视图；工作区列表与切换也在这里。
- **WorkspaceScope 是当前工作区的全部数据**：切换工作区 = 销毁旧实例、创建新实例。
- **Session 不做独立管理器**：切换直接委托 pi，SessionAdapter 只负责事件桥与 UI 上下文重绑。

### 1.2 三级状态

| 级别          | 生命周期   | 拥有                                                                                                                             | 资源加载                                | 持久化                                                                        |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| **App**       | 进程       | 模型目录、凭证、插件安装、Pi 包、全局设置、系统视图、工作区列表、当前工作区                                                      | App 私有全局资源根                      | `agentDir`、官方凭证链                                                        |
| **Workspace** | 打开工作区 | 项目设置、URA（绑定 / 集合 / 资源地图）、列表、标签视图集合、UI 现场、页面会话、写会话、会话索引、浏览器策略、站点快照、派生数据 | App 私有工作区资源根                    | `workspace.json`、`ui-state.json`、`settings.json`、`sessions/`、`resources/` |
| **Session**   | 一个会话   | pi runtime、消息、轮次、流式、队列、上下文快照（资源地图版本、AGENTS、技能激活）                                                 | 工作区已解析的 ResourceSet + 会话上下文 | `sessions/*.jsonl`                                                            |

**与 pi CLI 的边界**：WorkStudio 是独立软件。`agentDir`、扩展 / 技能目录、工作区 `.pi` 目录全部在 App 私有数据目录；不读取 `~/.pi/agent`，也不读取真实工作区的 `.pi`。pi 只作为库运行。

- **工作区列表归 App**：因为 App 负责切换；列表本身不随当前工作区销毁。
- **工作区级数据列表由 AppHost 管理**：AppHost 经 WorkspaceManager 创建、替换、销毁资源分组、会话索引、标签集合等；WorkspaceScope 只是当前活动实例，不是跨工作区复用的单例。
- **会话级状态归 pi**：账号、模型、轮次、消息、压缩都在 pi 内；WorkStudio 只持当前会话的投影。

### 1.3 资源、页面、技能是加载方式，不是第四级

| 对象 | App 级                                                                            | Workspace 级                                                                                                    | Session 级                   |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 资源 | 全局安装：`<appData>/agent/extensions`、`skills`、`settings.json`、`npm/`、`git/` | 工作区资源：`<appData>/agent/ws/<id>/.pi/extensions`、`.pi/skills`、`.pi/settings.json`、`.pi/npm/`、`.pi/git/` | 资源快照 + 读写              |
| 页面 | 页面代码与静态资源                                                                | 页面实例、标签、页面会话、页面偏好                                                                              | 页面内容只引用资源 ref       |
| 技能 | 全局装载                                                                          | 工作区装载 + 默认选择                                                                                           | 激活集（哪些技能进本轮提示） |

- **目录全部 App 私有**：不写 `~/.pi`，不写真实工作区 `.pi`；WorkStudio 与 pi CLI 完全独立。资源装载的 project root 指向 `<appData>/agent/ws/<id>/.pi`，会话 cwd 仍是真实工作区。
- **装载在 App / Workspace，激活在 Session**：会话切换不重新装载资源，只切换上下文快照与激活集。
- **安装即信任**：扩展与技能只从 App 管理的目录装载，不引入 project trust。
- URA 的注册表与绑定表是 App 级（插件装载时注册）；集合、资源地图、页面会话、写会话是 Workspace 级。

### 1.4 模块

| 层     | 模块                 | 职责                                                            |
| ------ | -------------------- | --------------------------------------------------------------- |
| 主进程 | **AppHost**          | 组合根；作用域生命周期；统一命令 / 快照 / 事件出口              |
| 主进程 | **AppScope**         | 模型、凭证、插件、Pi 包、全局设置、系统视图、工作区列表与切换   |
| 主进程 | **WorkspaceManager** | 工作区注册表、当前工作区、切换事务                              |
| 主进程 | **WorkspaceScope**   | 当前工作区的 URA、列表、视图、UI、页面/写会话、会话索引、浏览器 |
| 主进程 | **SessionAdapter**   | pi 会话适配：切换、事件桥、UI 上下文重绑                        |
| 主进程 | **PluginRegistry**   | zip 清单、安装索引、插件装载（内置 + 已安装 + 本地路径）        |
| 主进程 | **ListRegistry**     | 列表定义注册（内置 + 插件）                                     |
| 主进程 | **ListService**      | 定义 + provider 数据 + UI 覆盖 → ListSnapshot                   |
| 渲染层 | **ListHost**         | 按 ListSnapshot 渲染分组、行、动作、空态                        |
| 渲染层 | **壳层与系统页面**   | 壳层 DOM、助手、浮层、捕获层                                    |

**AppHost 管两级，Session 交给 pi；列表结构在 App，列表数据在当前工作区，渲染只认规范。**

### 1.5 实体

| 实体     | 字段                                                                                 | 说明                            |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| 工作区   | 路径 · 创建时间 · 最近打开                                                           | App 持有列表；当前 = 最近打开者 |
| 列表定义 | id · section · label · icon · order · itemType · fields · actions · empty · grouping | App 级；内置 + 插件             |
| 列表分组 | id · definitionId · section · label · count · state · items · empty · diagnostics    | Workspace 级；一次快照          |
| 列表项   | key · itemType · title · subtitle · icon · badge · meta · actions · state            | 渲染层只读                      |
| 视图实例 | 稳定键 · 类型 · 标题 · 逻辑地址 · 状态 · 激活 · 固定 · 脏态 · 临时                   | 工作区级                        |
| 会话     | 路径 · 标题 · 预览 · 时间 · 消息 · token                                             | 真相在 pi                       |
| 设置页   | id · label · desc · icon                                                             | App 清单投影                    |
| 插件     | id · 名称 · 版本 · 图标 · 页面 · 来源 · hash                                         | App 清单投影                    |
| 现场     | 主题 · 侧栏形态 / 收起 / 宽度 · 助手形态 · 打开集合                                  | 工作区级 UI                     |
| 交互态   | 类型 · 目标 · 方向 · 锚点 · 预览几何                                                 | 仅指针按下期间存在              |

## 二、数据模型与契约

### 2.1 作用域与纪元

```ts
type Scope = 'app' | 'workspace' | 'session' | 'ui';
type ListSourceScope = 'app' | 'workspace';

interface ScopeEpochs {
  workspace: number; // 工作区切换 ++
  session: number; // 会话切换 ++
}
```

| 切片         | 级别      | 归属                | 切换时                |
| ------------ | --------- | ------------------- | --------------------- |
| `app`        | App       | AppScope            | 不变                  |
| `workspaces` | App       | AppScope            | 只更新 `lastOpenedAt` |
| `workspace`  | Workspace | WorkspaceScope      | 整体替换              |
| `ui`         | Workspace | WorkspaceScope      | 整体替换              |
| `session`    | Session   | pi / SessionAdapter | 整体替换              |

- App 不设 epoch。
- 工作区切换：`workspaceEpoch++`，`sessionEpoch` 切到新会话。
- 会话切换：`sessionEpoch++`。
- `AppEvent` 带 `scope + epoch`；渲染层丢弃旧 epoch 的事件。

### 2.2 AppSnapshot

```ts
interface AppSnapshot {
  app: AppSlice;
  workspaces: WorkspaceMeta[];
  workspace: WorkspaceSlice;
  ui: WorkspaceUiSlice;
  session: SessionSlice;
  /** 壳层几何（主进程计算，DOM 与原生视图共用）。 */
  layout: LayoutSnapshot | null;
  seq: number;
  workspaceEpoch: number;
  sessionEpoch: number;
}
```

**AppSlice（应用级）**

```ts
interface AppSlice {
  models: ModelCatalogView;
  credentials: CredentialStatus[];
  plugins: PluginInfo[];
  pluginSources: PluginSourceInfo[];
  resources: ResourceSet; // App 私有全局资源
  settings: SettingsLayer; // global 层
}

interface ModelCatalogView {
  providers: ProviderView[];
  models: ModelOption[];
  defaultModel: string | null;
}

interface ProviderView {
  id: string;
  label: string;
  configured: boolean;
}

interface ModelOption {
  provider: string;
  id: string;
  label: string;
  thinkingLevels?: string[];
}

interface CredentialStatus {
  providerId: string;
  configured: boolean;
  source: 'keychain' | 'env' | 'none';
}

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  icon?: string;
  page?: string;
  builtin: boolean;
  source?: string;
  hash?: string;
  apiVersion?: number;
}

interface PluginSourceInfo {
  source: string;
  type: 'zip' | 'local';
  label?: string;
  sha256?: string;
  installedId?: string;
  version?: string;
}

interface PiPackageInfo {
  source: string;
  ref?: string;
  scope: 'app' | 'workspace';
  loaded: boolean;
  resources?: number;
}

interface SettingsLayer {
  values: Record<string, unknown>;
}

interface WorkspaceSettingsView {
  project: Record<string, unknown>;
  effective: Record<string, unknown>;
}
```

**WorkspaceSlice（工作区级）**

```ts
interface WorkspaceMeta {
  id: string; // 路径派生的稳定短 id
  path: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
}

interface WorkspaceSlice {
  meta: WorkspaceMeta;
  settings: WorkspaceSettingsView; // project 层 + 合并结果
  resources: WorkspaceResourceSet;
  lists: ListSnapshot;
  views: ViewEntry[];
  sessions: SessionMeta[];
}

interface SessionMeta {
  path: string;
  title: string;
  preview: string;
  updatedAt: number;
  messageCount: number;
  tokens: { input: number; output: number; total: number };
}
```

**WorkspaceUiSlice（工作区交互状态）**

```ts
interface WorkspaceUiSlice {
  theme: 'light' | 'dark';
  sidebar: {
    view: SidebarView;
    domain: string | null;
    collapsed: boolean;
  };
  paneWidths: { left: number; right: number };
  assistant: {
    open: boolean;
    floating: boolean;
    inputExpanded: boolean;
  };
  openSessionPaths: string[]; // 会话标签；当前会话以 session.meta.path 为准
}

type SidebarView =
  | 'main'
  | 'docs'
  | 'data'
  | 'web'
  | 'plugins'
  | 'settings'
  | 'find';
```

**SessionSlice（会话级，pi 投影）**

```ts
interface SessionSlice {
  meta: SessionMeta | null;
  status: 'idle' | 'streaming' | 'compacting' | 'error';
  streaming: StreamingState | null;
  queue: { steering: number; followUp: number };
  messages: ChatMessage[];
  usage: { input: number; output: number; total: number };
  context: {
    resourceMapVersion: string;
    activeSkills: string[];
    agentsFileVersion: string | null;
  };
}

interface StreamingState {
  sessionPath: string;
  startedAt: number;
  thinking?: string;
  text?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  createdAt: number;
  tool?: {
    name: string;
    status: 'running' | 'done' | 'error';
    summary?: string;
  };
}
```

**视图投影**

```ts
type ViewType = 'document' | 'plugin' | 'settings' | 'browser';

type ViewState =
  | 'dormant'
  | 'loading'
  | 'ready'
  | 'contentDelivered'
  | 'error'
  | 'destroyed';

interface ViewEntry {
  key: string; // 稳定键
  id: string; // 运行时实例 id
  type: ViewType;
  title: string;
  url: string;
  state: ViewState;
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  temporary?: boolean;
  document?: DocumentMeta;
  plugin?: PluginInfo;
  actions?: ViewActionView[];
}

interface ViewActionView {
  id: string;
  label: string;
  icon?: string;
  toggle?: boolean;
  active?: boolean;
}

interface DocumentMeta {
  id: string;
  title: string;
  ref: string;
  source: string;
  sourceLabel: string;
  ext?: string;
  group?: { id: string; title: string; icon?: string };
  description?: string;
  updatedAt?: number;
}
```

### 2.3 AppCommand 与 AppEvent

```ts
interface AppCommand<T = unknown> {
  scope: Scope;
  action: string; // 域.动作
  payload?: T;
}

interface AppEvent<T = unknown> {
  scope: Scope;
  epoch: number;
  seq: number;
  event: T;
}
```

- `scope` 决定路由与允许的来源；来源校验在 AppHost 路由层完成。
- `workspace` 命令带当前 `workspaceEpoch`；切工作区后旧命令丢弃。
- `session` 命令带当前 `sessionEpoch`；切会话后旧命令丢弃。
- 事件按 scope 合并 / 定序；高频增量合帧，定序事件不合并。

### 2.4 列表模型

列表结构由 App 定义，数据由当前工作区解析；渲染层只消费 `ListSnapshot`。

```ts
interface ListDefinition {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  sourceScope: ListSourceScope;
  section?: 'resources' | 'plugins' | 'settings'; // 缺省 resources
  itemType: string; // document / session / link / plugin / settings / ...
  fields: ListFieldSpec[];
  actions: ListActionSpec[];
  empty?: { icon?: string; text: string };
  grouping?: 'flat' | 'domain' | 'custom';
}

interface ListFieldSpec {
  key: string; // title / subtitle / time / badge / meta.<key>
  label?: string;
  type: 'text' | 'time' | 'badge' | 'icon' | 'count';
}

interface ListActionSpec {
  id: string;
  label: string;
  icon?: string;
  scope: Scope;
  action: string; // AppCommand.action
  confirm?: boolean;
}

interface ListItem {
  key: string; // ref / 会话路径 / 插件 id
  itemType: string;
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: string;
  meta?: Record<string, unknown>;
  actions?: string[];
  state?: {
    open?: boolean;
    active?: boolean;
    dirty?: boolean;
    disabled?: boolean;
  };
}

interface ListGroup {
  id: string;
  definitionId: string;
  label: string;
  icon?: string;
  order?: number;
  count: number;
  state: 'loading' | 'ready' | 'error';
  fields: ListFieldSpec[];
  actions: ListActionSpec[];
  empty?: { icon?: string; text: string };
  items: ListItem[];
  diagnostics?: string[];
}

interface ListSnapshot {
  workspaceEpoch: number;
  groups: ListGroup[];
}
```

- `ListGroup` 内嵌 `fields` / `actions` / `empty`，使快照自包含；`ListDefinition` 仍只存 App。
- `WorkspaceSlice.sessions` 是会话索引的类型化投影；`lists` 中的 `sessions` 分组由它生成。
- `ListDefinition` 属于 App（内置 + 插件注册）。
- `ListSnapshot` 属于 Workspace；工作区切换整体替换。
- `itemType` 决定渲染层行模板；未知类型回落通用行。
- 列表的打开 / 激活 / 脏态是 UI 覆盖，由 App 在生成快照时合并。

### 2.5 资源加载模型

资源加载按作用域分层，目录全部在 App 私有数据目录；WorkStudio 与 pi CLI 完全独立。

```ts
interface ResourceSet {
  extensions: InstalledExtension[];
  skills: SkillInfo[];
  packages: PiPackageInfo[];
  diagnostics: ResourceDiagnostic[];
}

interface WorkspaceResourceSet extends ResourceSet {
  resourceMap: { ref: string; version: string };
  policy: ResourcePolicy;
}

interface ResourcePolicy {
  enabledExtensions: string[];
  disabledExtensions: string[];
  defaultSkills: string[];
}

interface InstalledExtension {
  id: string;
  name: string;
  version?: string;
  source: 'builtin' | 'package' | 'file';
  path: string;
  scope: 'app' | 'workspace';
  enabled: boolean;
  tools: string[];
  commands: string[];
}

interface SkillInfo {
  name: string;
  description: string;
  source: 'app' | 'workspace' | 'plugin';
  path: string;
  manualOnly: boolean;
}

interface ResourceDiagnostic {
  type: 'info' | 'warn' | 'error';
  message: string;
  path?: string;
}
```

| 级别      | 目录（App 私有）                                                                                    | 内容                          |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| App       | `<appData>/agent/extensions`、`skills`、`settings.json`、`npm/`、`git/`                             | 全局安装的扩展 / 技能 / Pi 包 |
| Workspace | `<appData>/agent/ws/<id>/.pi/extensions`、`.pi/skills`、`.pi/settings.json`、`.pi/npm/`、`.pi/git/` | 工作区级资源与策略            |
| Session   | 无目录                                                                                              | 只持有激活集与资源快照        |

- **不读写 `~/.pi`，也不读写真实工作区 `.pi`**；pi 只作为库运行。
- **安装即信任**：扩展与技能只从 App 管理的目录装载，不引入 project trust。
- **默认全局安装**：设置页默认写 App 级；`<appData>/agent/ws/<id>/.pi` 是可选的工作区资源根，不指向真实项目。
- **工作区级只做启用策略**：`enabledExtensions` / `disabledExtensions` / `defaultSkills` 决定当前工作区启用哪些、默认选哪些；不改变包的安装位置。
- **开关粒度**：extension 集合在会话创建 / 工作区切换时装配，会话内不做热开关；skills 按会话激活。
- **会话级只做激活**：`activeSkills` 进本轮提示；extension 集合在会话创建时继承工作区策略。
- 页面会话与写会话是工作区级瞬态；关闭标签或销毁工作区时释放。

```ts
interface PageSessionInfo {
  id: string;
  ref: string;
  version: string;
  codec: string | null;
  surface: string;
  page: string;
}

interface WriteSessionInfo {
  id: string;
  ref: string;
  dirty: boolean;
}
```

### 2.6 握手与重建

```
渲染层启动 / 重连
  → app.sync
  → AppSnapshot（app → workspaces → workspace → ui → session）
  → 订阅 AppEvent（带 seq / epoch）
```

- 订阅先于快照；快照覆盖本地投影。
- 检测到缺口 → 重新 `app.sync`，不做事件回放。
- 工作区切换 / 会话切换都会 bump 对应 epoch；旧事件自动失效。

### 2.7 页面数据面与视图总线

- 页面只持语义桥：白名单命令 + 视图总线；无 Node、无裸 IPC。
- 页面来源校验后按映射转发到同一命令实现；未映射命令不存在。
- 投递必须等页面明确就绪；未就绪由主进程排队。
- 页面只声明入口与协议，不持有视图句柄。
- 设置页与插件页共用同一套桥；页面偏好存本插件分区。

## 三、AppHost 与切换

### 3.1 启动装配

```
AppScope
  → 工作区列表 / 当前工作区
  → WorkspaceScope（当前工作区）
  → pi runtime（workspace cwd / App 私有 sessions / 资源根）
  → SessionAdapter（当前会话 / 事件桥）
  → 系统视图 + 壳层
```

装配顺序固定：IPC 注册先于建窗；pi runtime 先于视图，视图内容投递依赖会话与资源就绪。

### 3.2 工作区切换

```
AppHost.switchWorkspace(next)
  1. flush 当前 UI 现场
  2. dispose 当前 WorkspaceScope
     （标签视图 / 页面会话 / 写会话 / 监听器 / 派生任务 / 列表订阅）
  3. 注册并加载 next workspace
  4. 创建 WorkspaceScope
  5. 重建 pi runtime（workspace cwd / 工作区私有资源根）
  6. workspaceEpoch++ → 广播 AppSnapshot
```

- 工作区列表留在 AppScope；只换 `activeWorkspace` 与 `workspace` 切片。
- 旧工作区的标签、页面会话、写草稿、列表快照全部失效，不跨工作区复用。
- 会话切换由 pi 负责；工作区切换会重建 pi runtime。

### 3.3 会话切换

```
SessionAdapter.switchSession(path)
  → pi.runtime.switchSession(path)
  → detach / attach EventBridge
  → 重绑扩展 UI 上下文
  → sessionEpoch++ → 广播 session 切片
```

- 不销毁工作区、不重建视图集合、不重载资源。
- 会话列表是工作区级数据；激活项属于 UI 现场。
- 技能激活集随会话上下文解析，不写全局单例。

### 3.4 作用域释放

WorkspaceScope 释放时按序清理：

1. 取消所有 watch / 事件订阅。
2. 关闭页面会话与写会话（内存草稿不落盘）。
3. 销毁标签视图；系统视图保留（App 级）。
4. flush UI 现场并停止派生任务。
5. 断开 pi runtime。

### 3.5 隔离与持久化

| 数据     | 位置                | 说明                                                       |
| -------- | ------------------- | ---------------------------------------------------------- |
| 模型目录 | 应用数据目录        | 供应商 / 模型清单，密钥不落此处                            |
| 凭证     | 官方凭证链          | 运行时覆盖仅内存                                           |
| 全局设置 | 应用数据目录        | App 级                                                     |
| 工作区   | 自描述文件          | 路径 / 创建时间 / 最近打开                                 |
| 项目设置 | 工作区              | 与全局深度合并；置空删键；未知字段保真                     |
| UI 现场  | 工作区              | 主题 / 栏宽 / 打开集合 / 助手形态，可重建                  |
| 派生数据 | 工作区              | 资源地图 / 结构化索引 / 页面缓存，可重建；网页快照不在此列 |
| 会话     | 工作区              | JSONL；空会话不落盘                                        |
| 插件     | 安装目录 + 来源声明 | 本地来源原地加载                                           |

- 内存 + 标脏 + 防抖 + 退出强制落盘；临时文件 → 原子替换。
- 工作区切换先 flush 旧作用域，再加载新作用域。
- 当前工作区 = 最近打开者，没有第二份「当前选中」文件。

## 四、列表框架

### 4.1 定义

列表定义由 App 持有，完整类型见 §2.4。定义只描述结构，不携带数据：

- `sourceScope`：数据来自 App 还是当前工作区。
- `section`：侧栏主形态归属（资源 / 插件 / 设置）；渲染层不按列表 id 写死过滤。
- `itemType`：渲染层行模板。
- `fields`：行内字段（标题 / 副行 / 时间 / badge / meta）。
- `actions`：可用动作（打开 / 关闭 / 固定 / 删除 / 插件动作）。
- `empty` / `grouping`：空态与分组语义。

### 4.2 注册与扩展

- `ListRegistry` 是 App 级注册表：内置列表与插件列表用同一接口。
- 插件通过 `registerList({ definition, provider })` 贡献分组；定义在装载期注册，数据按工作区解析。
- `provider` 只拿工作区上下文（tree / find / settings / 当前工作区），拿不到视图句柄与写通道。
- 内置列表也是注册项：`docs`、`web`、`temp`、`sessions`、`plugins`、`settings`。
- 同 id 后注册者胜出并记诊断；不兼容的定义在注册期拒绝。

### 4.3 解析与快照

`ListService` 位于 WorkspaceScope：

```
ListRegistry（定义）
  + provider（工作区数据）
  + UI 覆盖（打开 / 激活 / 脏态 / 折叠）
  → ListSnapshot（按 order / 分组语义排序）
```

- 数据源可以返回空组；空组不渲染，但保留定义用于空态。
- 计数、空态、错误、诊断由 App 生成，渲染层不统计。
- 列表刷新受工作区 epoch 约束；旧数据不进入新工作区快照。

### 4.4 渲染

```
ListHost
├─ GroupHeader：标题 / 图标 / 计数 / 折叠
├─ RowRenderer：按 itemType 选择行模板
├─ ActionBar / 上下文菜单：按 ListActionSpec
└─ Loading / Empty / Error：按 snapshot
```

- 渲染层不写死分组（不再有 docs / web / 临时网页的特例）。
- 行模板只消费 `ListItem`，未知 `itemType` 回落通用行。
- 打开、关闭、固定、删除等动作统一发 `list.action`；由 AppHost 路由。
- 折叠、固定、排序属于工作区 UI 现场，写回 App 后重新生成快照。

### 4.5 内置列表

| id         | 数据来源            | 行模板   | 说明                             |
| ---------- | ------------------- | -------- | -------------------------------- |
| `docs`     | 工作区文件          | document | 未被其他 provider 认领的本地文件 |
| `web`      | 站点快照 / 白名单域 | document | 按域分组                         |
| `temp`     | 未归档的网页标签    | link     | 不落盘，只活在标签里             |
| `sessions` | pi 会话索引         | session  | 工作区级；切换会话只换激活       |
| `plugins`  | 插件清单            | plugin   | App 数据，工作区展示             |
| `settings` | 设置页清单          | settings | App 数据，工作区展示             |

## 五、视图管理（Workspace）

### 5.1 内容类型

内容区只有三种承载；资源文档由 ref 解析后落入其中一种：

| 类型     | 来源                       | 稳定键           | 页面                     |
| -------- | -------------------------- | ---------------- | ------------------------ |
| 资源文档 | 资源 ref                   | `resource:<ref>` | 解析后落插件页或网页     |
| 插件页   | 插件的 page                | `plugin:<id>`    | 插件自带 webapp          |
| 设置页   | 主进程清单 + 插件 settings | `settings:<id>`  | 内置页面 / 插件设置页    |
| 在线网页 | URL                        | `browser:<url>`  | WebContentsView 实时视图 |

- **插件页**：页面由插件提供，只能装载插件目录内资源。
- **设置页**：内置页清单与页面归主进程；插件设置页归设置面。
- **欢迎页**：与设置页共用页面协议与页面桥，但 `settings.list` 不返回；由标签栏「新增」打开，且作为空集合的默认页。
- **欢迎页**：内部设置页 `settings://welcome`，不出现在设置列表。无工作区时可打开本地目录作为工作区；已有工作区时按已注册的本地文件 codec 新建文件。同键复用，最多一个。
- **网页**：无桥、无页面数据面；导航与窗口打开由视图宿主收束。

### 5.2 视图集合

| 规则     | 说明                                               |
| -------- | -------------------------------------------------- |
| 稳定键   | 同键复用实例；打开同键 = 激活，不新增标签          |
| 临时网页 | 不在白名单的网页标为临时；可批量清理               |
| 固定标签 | 无关闭钮；排序时保持固定区在前                     |
| 关闭     | 移除记录并释放页面会话；关闭当前标签后激活相邻项   |
| 恢复     | 持久化的是稳定键与顺序；启动时先建记录，激活才物化 |
| 失效     | 资源删除 / 插件卸载 / 地址失效时，恢复阶段丢弃该键 |

- 标签标题、固定位与顺序由主进程投影给出；渲染层只渲染与发命令。
- 工作区切换时视图集合整体销毁；系统视图不随工作区销毁。

### 5.3 生命周期

```
创建（dormant）
   │ 激活 / 恢复
   ▼
materialize ─► loading ─► ready ─► contentDelivered
                   │                     │
                   └──── error ◄─────────┘
                          │
                       关闭 → destroyed
```

**懒物化**：启动恢复只建记录；首次激活才建 WebContentsView。崩溃 / 内存回收后的视图标记待重载，激活时补一次加载。

### 5.4 布局

主进程计算全部矩形；壳层 DOM 与原生视图消费同一份快照。

```
window
├ titlebar
└ workbench
   ├ sidebar
   ├ resourcePane
   │   ├ tabbar
   │   └ content        ← 原生视图 bounds
   └ assistant          （dock / floating）
overlay / capture       （覆盖在 workbench 之上）
```

- 渲染层上报页面视口；布局取窗口与视口的较小者。
- 视图矩形整体捕获鼠标，分隔条两侧留让位带。
- 视图内容裁剪在自身矩形内；页面内弹出层必须在视图内展开。

### 5.5 交互

```
pointerdown ─► 主进程建立会话（捕获层可见）
             ─► 移动信号 → 主进程计算预览 → 广播
             ─► pointerup / 失焦 / Esc → 提交或取消
```

拖拽期间指针会离开原渲染进程，因此几何与预览归主进程；捕获层只上报信号。

### 5.6 平台事实

| 事实                                      | 设计后果                                     |
| ----------------------------------------- | -------------------------------------------- |
| WebContentsView 是 OS 表面，DOM 无法跨越  | 壳层不能覆盖内容；模态 / 菜单 / 拖拽走原生层 |
| 视图只有「后加者在上」                    | 层级显式化：内容 → 助手 → 浮层 → 捕获层      |
| 一个 webContents 只能出现在一个视图       | 标签与浮层不能共享同一实例                   |
| 容器寿命长于页面                          | 视图命令按「容器在、页面可能已死」处理       |
| 页面进程可能崩溃或被回收                  | 视图各自进入错误 / 待重载，不影响其他视图    |
| 内容投递无回执                            | 必须等页面就绪后再投递，主进程排队           |
| 导航是后一次抢占前一次                    | 取消不是失败，只认主框架真实失败             |
| 视图 bounds 为整数 DIP                    | 全部几何在主进程按窗口坐标计算               |
| 视图整体捕获鼠标                          | 分隔条两侧必须留让位带                       |
| `webContents.debugger` 可 attach 任意视图 | 自动化不需要第二个浏览器运行时               |
| 协议 handler 按 session 隔离              | 每个分区都要注册页面协议                     |
| 沙箱 preload 只接受 CJS 单文件            | 契约桥单文件构建，共享常量内联               |
| 主进程 ESM 无 import map                  | 扩展隔离不能靠模块系统，信任在安装期         |

## 六、资源管道 URA

URA 是资源内容的唯一入口：人、AI、页面都只拿 ref，不拿路径与句柄。

设计取向：请求侧不知道远端会返回什么，所以格式由响应决定；调用方不关心实现，所以表现层按能力选择；写按资源键串行，所以写必须先进入草稿再显式提交。

### 6.1 读与写

```
读：
ref ─► transport ─► { mime, bytes }
                ─► 绑定(transport, mime) ─► codec ─► 文档
                                                 └─► store ─► 结构化数据（派生）
                ─► 绑定(transport, mime, codec) ─► presenter
                       ├ page    ─► 插件页面
                       └ sidecar ─► 文本 / schema

写：
变更 ─► 定位（投影映射）─► 编码（最小补丁）─► 来源提交
     ─► 缓存失效 ─► 结构化数据更新 ─► 广播
```

| 控制项   | 机制                                                    |
| -------- | ------------------------------------------------------- |
| 寻址     | `scheme://authority/path`；ref 是身份，不带格式与表现层 |
| 物理访问 | 只有 transport 触达文件 / 网络 / 服务                   |
| 解释     | codec 按声明处理；未知或失败降级 raw                    |
| 可见性   | 模型侧只给 schema；页面侧拿可编辑投影                   |
| 并发     | 写会话 + 分片队列；同键串行，最后写入胜出               |
| 传播     | 所有写经同一出口：缓存、结构化数据、订阅一致            |

### 6.2 MIME 与 transport

MIME 是 transport 与 codec 之间的格式身份，采用标准 `Content-Type` 的 `type/subtype` 形式；核心维护一张**规范化表**：transport 可以返回原始 `Content-Type`，管道按别名归一后再进入绑定。

**内置 MIME**

| MIME                                                                        | 扩展名                 | 当前处理                                  | 状态        |
| --------------------------------------------------------------------------- | ---------------------- | ----------------------------------------- | ----------- |
| `text/plain`                                                                | `.txt .log .ini .conf` | 文本编辑器                                | 内置        |
| `text/markdown`                                                             | `.md .markdown`        | Markdown 阅读器                           | 内置        |
| `text/html`                                                                 | `.html .htm`           | 文件 → HTML 阅读器；https + live → 浏览器 | 内置        |
| `application/json`                                                          | `.json`                | raw（JSON 视图规划）                      | 内置（raw） |
| `application/xml`                                                           | `.xml`                 | raw（XML 视图规划）                       | 内置（raw） |
| `application/yaml`                                                          | `.yaml .yml`           | raw（YAML 视图规划）                      | 内置（raw） |
| `text/csv`                                                                  | `.csv`                 | 表格视图                                  | 规划        |
| `text/tab-separated-values`                                                 | `.tsv`                 | 表格视图                                  | 规划        |
| `application/pdf`                                                           | `.pdf`                 | PDF 视图 / 系统打开                       | 规划        |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document`   | `.docx .docm .dotx`    | DOCX 编辑器                               | 内置        |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`         | `.xlsx .xlsm .xltx`    | XLSX 阅读                                 | 内置        |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx .pptm .potx`    | PPT 视图                                  | 规划        |
| `image/png`                                                                 | `.png`                 | 图片视图                                  | 规划        |
| `image/jpeg`                                                                | `.jpg .jpeg`           | 图片视图                                  | 规划        |
| `image/gif`                                                                 | `.gif`                 | 图片视图                                  | 规划        |
| `image/webp`                                                                | `.webp`                | 图片视图                                  | 规划        |
| `image/svg+xml`                                                             | `.svg`                 | 图片视图                                  | 规划        |
| `application/octet-stream`                                                  | —                      | raw 兜底                                  | 内置        |

**别名归一**

| 原始值                                      | 归一为             |
| ------------------------------------------- | ------------------ |
| `text/x-markdown`、`application/x-markdown` | `text/markdown`    |
| `text/xml`、`application/xml`               | `application/xml`  |
| `application/x-yaml`、`text/yaml`           | `application/yaml` |
| `image/jpg`                                 | `image/jpeg`       |
| `application/x-pdf`                         | `application/pdf`  |

- MIME 参数（`charset` 等）不进入标识，单独保留为元数据。
- 未知 MIME 允许存在，但只有注册了 codec 才能解码；否则 raw。
- 自定义类型用 vendor 形式：`application/vnd.<vendor>.<name>+json` / `+zip`。

**transport 类型**

| id       | scheme        | 能力                        | 变更检测                    | 状态     |
| -------- | ------------- | --------------------------- | --------------------------- | -------- |
| `file`   | `file`        | read · write · list · watch | 内容哈希                    | 内置     |
| `http`   | `http`        | read · live                 | ETag / Last-Modified / 哈希 | 内置     |
| `https`  | `https`       | read · live                 | 同上                        | 内置     |
| `webdav` | 显式绑定      | read · write · list · watch | ETag                        | 规划     |
| `sftp`   | `sftp`        | read · write · list         | mtime + size                | 规划     |
| 业务来源 | 自定义 scheme | read / write / watch 按需   | 业务标识                    | 插件注册 |

- **transport id 是开放枚举**：内置 `file` · `http` · `https`，插件可注册自定义 id。
- **capabilities 枚举**：`read` · `write` · `list` · `watch` · `live`；注册时静态声明。
- **watch 是可选的 transport 能力**：文件用 `fs.watch` + `watchFile`；http(s) 不推送；WebDAV / SFTP 轮询；自定义来源可用 SSE / WebSocket。
- **transport id 与 scheme 分离**：绑定键用 id；一个 transport 可服务多个 scheme。
- 每个 scheme 有一个默认 transport；额外 transport 只能在绑定中显式选择。
- **框架核心只内建 `file` / `http` / `https`**：其余来源作为官方或第三方插件，通过同一 `registerTransport` 接入。

### 6.3 绑定与优先级

```
transport.read(ref)
  → { mime, bytes }
        ├─ 绑定(transport, mime) ─► codec
        └─ 绑定(transport, mime, codec) ─► presenter
                 ├ page    → 插件页面
                 └ sidecar → 文本 / schema
```

**绑定表**（两级键）：

```
codec:     (transport, mime)         → 用哪个解码器
store:     (transport, mime, codec)  → 结构化查询（派生）
presenter: (transport, mime, codec)  → 用哪个页面 / 文本出口
```

- `transport` 取注册的来源标识；`mime` 是规范值；没有 MIME 即 raw。
- **出口由 codec 带出**：换了 codec，presenter 的键就换了，页面跟着换。
- 能力（如 `live`）是 transport 的静态声明，用于默认绑定与可行性校验。

| 优先级 | 规则                 | 例子                                      |
| ------ | -------------------- | ----------------------------------------- |
| 1      | 用户显式绑定         | `https + text/html → browser`（codec 空） |
| 2      | transport 专属绑定   | `file + text/html + html → html-viewer`   |
| 3      | MIME 默认绑定        | `application/pdf + pdf → pdf-viewer`      |
| 4      | 能力匹配（fallback） | `requires ⊆ capabilities`，`live` 优先    |
| 5      | 顺序与诊断           | 同键后注册者胜出，并在注册页可见          |

- 绑定只决定「用哪个实现」，不改变 ref 与内容。
- 用户绑定优先，落应用数据目录。
- 两级绑定都落空 → raw + 通用文本投影。

**LLM 读取面是 sidecar**：不参与页面出口竞争，由门面读口径直接取：

- 已解码文档 → 结构化文本 / Markdown；
- 无 codec 或解码失败 → 原始文本 / 字节摘要；
- 浏览器快照 → Markdown；
- 数据类文档 → schema + query，不投递行数据。

### 6.4 写会话

| 项       | 设计                                         |
| -------- | -------------------------------------------- |
| 草稿     | 暂存不落盘、不进表现层、不进模型上下文       |
| 提交     | 单步 edit / write = 写会话的三步合成         |
| 队列     | 按资源键分片；同键串行，跨资源并行           |
| 写入     | 队列执行到即覆盖；最后写入胜出               |
| 外部变更 | watch 通知页面标记 stale；脏时提示重载或覆盖 |

### 6.5 页面会话

```
打开：ref → 解析页面 → 投递内容
就绪：页面主动上报
编辑：脏态 / 自动保存 / 手动保存
提交：文本或 saveBytes（二进制）；按队列顺序写入
外部变更：watch 标记 stale，脏时提示重载 / 覆盖
释放：关闭标签即释放会话
```

- 页面不持写队列与结构化数据；只持桥。
- 界面侧只有四件事：就绪上报、内容渲染、脏态上报、提交。
- 二进制文档以原始字节提交。
- 页面会话与视图记录绑定，关闭即释放；工作区销毁时全部释放。

### 6.6 变更与资源地图

- 事件维度：内容级、结构级、状态级。
- 所有写路径收敛到同一出口：工具、页面提交、外部文件变更、远端游标。
- **AGENTS.md 是 URA 托管的生成资源**：每工作区一份，内容 = 集合分组 + 每个资源的 codec + 数据 schema；写入与外部变更触发去抖重建。
- 资源地图按版本注入系统提示；会话进行中新写入的资源下一轮可见。

## 七、能力层

### 7.1 Agent

Agent 是 App 级的 pi 宿主；SessionAdapter 是它的会话级外观：

- 启动 pi runtime、暴露会话命令。
- 资源只从 App 私有目录装载：全局 `<appData>/agent`，工作区 `<appData>/agent/ws/<id>/.pi`；不读 `~/.pi`，也不读真实工作区 `.pi`。资源装载的 project root 与会话 cwd 分离：前者指向 App 私有 `.pi`，后者指向真实工作区。
- 扩展 / 技能安装即信任；工作区只应用启用策略，不引入 project trust。
- 会话切换直接委托 `pi.runtime.switchSession`；WorkStudio 只重绑事件桥与 UI 上下文。
- 会话索引属于 Workspace 级，供 `sessions` 列表使用。
- 技能激活属于会话级，由 SessionAdapter 在每轮提示时解析。

### 7.2 Harness

harness 是自持能力层，也是内置的 Pi Extension：提示、技能、工具。

产品上它只有一条来路：**资源地图**加**文本出口**。它不扫盘、不持内容。

| 类别       | 工具                                           | 通道         |
| ---------- | ---------------------------------------------- | ------------ |
| 资源管理型 | read · write · edit · grep · find · ls · query | URA 门面     |
| 操作型     | browser\_\* · 业务动作                         | 各自契约注入 |

- 7 个资源工具是门面的薄封装，不含 IO 与格式解释。
- 操作型工具不进 URA；浏览器工具依赖实现无关契约。
- pi 内置工具停用；插件不能注册工具。

系统提示：角色与边界 + 资源地图 + AGENTS.md + 数据轨（schema / query）。

### 7.3 设置

设置不碰管道：没有 transport / codec / store，只有页面与清单。

| 类型       | 清单 / 入口     | 页面                     | 清单归属 |
| ---------- | --------------- | ------------------------ | -------- |
| 内置页     | `settings.list` | 主进程拥有               | 设置面   |
| 插件设置页 | 插件清单        | 插件提供 `settings` 入口 | 设置面   |

- 内置页 ref 为 `settings://<id>`，插件设置页为 `settings://plugin.<id>`。
- 物理装载与插件页共用 `app://page` 协议、preload 桥、主题广播与会话生命周期。
- 新增内置设置 = 加一页 + 一条清单；插件设置页随插件版本走。

### 7.4 浏览器

浏览器是内建能力形态：在线系统已在服务端完成「取 → 解释 → 呈现」，客户端直接嵌入实时视图。

- **共享 session**：所有网页标签共用一个浏览器会话，登录态、cookie 与缓存一致。
- **导航直连**：不预取、不解码、不产生 ref，也不订阅变更。
- **白名单域 = 采集域**：域下多页转 Markdown 后入集合；名单外只作临时标签。
- **快照文件**：一个页面一个 Markdown；头部 `url` / `title` / `excerpt` / `domain` / `capturedAt`，正文 + 可访问性结构；同一 URL 重抓覆盖同一文件。
- **快照不走 transport / codec**：已是 Markdown，直接按文档登记，随资源地图同步。
- **自动化只给侧车**：`browser_*` 是唯一入口；页面、插件、命令都不暴露 CDP。
- **没有 edit**：网页没有草稿与编码环节，写入只发生在站点内部。

自动化工具：`browser_open` / `read` / `click` / `type` / `back` / `screenshot` / `snapshot`。实现走 `webContents.debugger` 的 `Input.*` 与 `Page.captureScreenshot`；正文、可访问性结构与可交互性标记由注入遍历产出。

## 八、渲染层

### 8.1 壳层结构

应用是**单一工作台窗口 + 系统视图**：壳层由 DOM 承载，标签内容一律由原生视图承载。

```
┌─ S1 TitleBar h=40 ─────────────────────────────────────────────────────────────────────┐
│ ← Workspace · Sidebar │        Address Capsule: 地址 + 工具条        │  Chat · Theme · W │
├─ S2 Sidebar ──────────┬─ S3 Resource Panel ────────────────────────┬─ S4 Assistant ─────┤
│ Resources│Plugins│设置 │ [Doc A ×] [设置 ×] [网页 ×]        ‹ ›    │ Chat 1 │ Float │ +  │
│───────────────────────│────────────────────────────────────────────│────────────────────│
│ ▸ 本地文档            │                                            │ 消息流             │
│   ▸ 子列表            │   Content area = native WebContentsView    │ 思考 / 文本 / 工具 │
│ ▸ 网站资料            │   插件页 / 设置页 / 网页                    │────────────────────│
│ ▸ 会话                │   DOM 只画空态                              │ 输入卡片           │
│ 展开项（已打开）       │                                            │ 模型 · 档位 · 发送 │
└───────────────────────┴────────────────────────────────────────────┴────────────────────┘
 S5 Overlays（内容区之上）：浮层 · 指针捕获层（交互期）
```

两条结构约束：

1. **内容与壳层分离**：标签内容全部在独立表面里；壳层不复制内容 UI，也不假设能遮盖它。
2. **打开集合唯一**：任何「打开」都进入资源面板的标签集合；没有第二套打开通道。

**部分与状态归属**：

| 部分              | 职责                                           | 状态归属                 |
| ----------------- | ---------------------------------------------- | ------------------------ |
| S1 TitleBar       | 工作区、侧栏开关、地址栏与动作、助手开关、主题 | 工作区 UI                |
| S2 Sidebar        | 资源 / 插件 / 设置三种浏览形态                 | 工作区 UI + ListSnapshot |
| S3 Resource Panel | 标签集合 + 内容区（原生视图）                  | 工作区视图集合           |
| S4 Assistant      | 会话标签、消息流、输入与档位                   | 会话投影 + 输入状态      |
| S5 Overlays       | 模态与扩展对话框；交互期指针入口               | App 级瞬态               |

**承载方式**：

| 区域                                   | 承载            | 说明                     |
| -------------------------------------- | --------------- | ------------------------ |
| 标题栏 / 侧栏 / 标签栏 / 空态 / 分隔条 | DOM             | 下拉与 hover 可自由实现  |
| 内容区                                 | WebContentsView | 插件页 / 设置页 / 网页   |
| 助手                                   | WebContentsView | 页面内部自绘消息流与输入 |
| 浮层 / 捕获层                          | WebContentsView | 浮层透明；捕获层常驻     |

### 8.2 S1 TitleBar

```
┌ 左区 ────────────────────┐ ┌ 中区（拖拽） ──────────────────────┐ ┌ 右区 ─────────┐
│ 工作区 ▾ · 侧栏开关 ▤    │ │ ▣ 逻辑地址                    ⟳ │ ▣▣ │ │ 助手 · 主题 · W │
└──────────────────────────┘ └───────────────────────────────────┘ └───────────────┘
```

| 操作        | 效果                                                     |
| ----------- | -------------------------------------------------------- |
| 工作区选择  | 换代：工作区列表不变，切换 workspace / ui / session 切片 |
| 侧栏开关    | 展开 / 固定宽图标列                                      |
| 地址栏动作  | 按激活视图类型渲染进胶囊内部工具条                       |
| 助手 / 主题 | 显隐助手；主题全局收敛                                   |

- 窗口控制留白按平台判定；下拉一律走原生菜单。
- 主题链路：UI 现场 → 系统主题层 → 壳层 / 页面 / 网页 / 原生控件 / 视图底色。

### 8.3 S2 Sidebar 与 ListHost

三种主形态由同一顶部导航切换：

```
            ┌──────────────┐
            │   Resources  │◄──► Plugins ◄──► Settings
            └──────┬───────┘
                   │ 二级形态
        ┌──────────┼──────────┐
      全部       数据       网页（域分组）
```

- **资源**：ListSnapshot 投影（docs / web / temp / sessions 等），分组行 + 展开项。
- **插件**：`plugins` 列表；点击打开插件页。
- **设置**：`settings` 列表；点击打开设置页。
- 行结构统一：图标 + 标题 + 副行 + badge；空分组不渲染。
- 收起态 = 固定宽图标列；切换形态走原生菜单。

Sidebar 只做三件事：

1. 按 `sidebarView` 选择列表 id；
2. 把 `ListSnapshot` 交给 `ListHost`；
3. 把行点击 / 动作转成 `AppCommand`。

不再有 `localDocs` / `webDocs` / `webGroups` 这类按 source 写死的过滤。

### 8.4 S3 Resource Panel

标签 = 视图实例的投影；顺序即集合顺序，激活位由主进程快照给出。

```
┌───────────────────────────────┐
│ ▣  标题（≤128px）  ●  ×       │  激活：顶部 1px 高亮
└───────────────────────────────┘  固定：Pin 图标，无关闭钮
   ↑类型图标   ↑脏点 / 错误      拖动：插入位竖线
```

- 标签栏右端有「新增」按钮：打开欢迎页；同键复用，最多一个。
- 打开集合为空时自动打开欢迎页；关闭最后一个标签后也会补开。
- 关闭 / 固定 / 排序 / 批量关闭都经命令回主进程；渲染层不直接改集合。
- 集合语义、生命周期与懒物化见「视图管理」。

### 8.5 S4 Assistant

| 形态 | 布局                        | 切换       |
| ---- | --------------------------- | ---------- |
| 停靠 | 右侧固定栏                  | 默认       |
| 浮动 | 独立原生视图，可拖拽 / 缩放 | 标题栏按钮 |
| 收起 | 隐藏视图，状态保留          | 助手开关   |

- 会话标签行独立于视图标签：切换会话只换消息流，不影响打开集合。
- 输入区：模型 / 档位 / 技能 / 发送；流式中可插话或停止。
- 消息流：用户气泡、思考、文本、工具调用、错误；全部来自 AppEvent。

### 8.6 S5 系统视图

| 视图   | 用途                 | 生命周期                   |
| ------ | -------------------- | -------------------------- |
| 浮层   | 模态、扩展 UI 对话框 | App 级单例；无对话框时隐藏 |
| 捕获层 | 交互期接收指针       | App 级；交互时可见         |

浮层必须走原生视图：模态不能被 DOM 覆盖，也不能被内容视图遮挡。

### 8.7 视觉

| 项     | 规范                                             |
| ------ | ------------------------------------------------ |
| 主题   | 亮 / 暗两套；一切亮暗派生自系统主题层            |
| 标题栏 | 40px，整条可拖拽；按钮为可交互区                 |
| 标签   | 36px，激活顶部 1px 高亮；脏点与关闭钮 hover 出现 |
| 侧栏   | 15%–30% 窗口宽；收起 56px 图标列                 |
| 分隔条 | 6px 让位带，两侧取邻栏表面色                     |
| 空态   | 居中图标 + 一句引导，不画假内容                  |
| 字体   | 系统字体栈；等宽用于地址与代码                   |

### 8.8 投影与纪元

- 渲染层只持 `AppSnapshot` 的四块投影：`app` / `workspace` / `ui` / `session`。
- 收到事件先比对 `workspaceEpoch` / `sessionEpoch`，旧作用域事件直接丢弃。
- 重连先 `app.sync` 重建，再做增量。
- 乐观更新只用于输入态；集合与列表以快照收敛。

## 九、扩展接入

### 9.1 pi 双轴

```
资源轴（声明式）                    注册轴（命令式）
包清单 / 约定目录 / 设置路径        扩展模块执行时调用注册 API
extensions · skills                 tools · commands · hooks
prompts · themes                    providers · renderers
        │                                   │
        └────────────► pi 运行时 ◄──────────┘
                           │
                    WorkStudio 能力层
```

| 轴     | 性质                             | 谁收集                      |
| ------ | -------------------------------- | --------------------------- |
| 资源轴 | 装载：声明有什么文件，不执行代码 | 包管理器扫文件 → 资源装载器 |
| 注册轴 | 执行：扩展工厂运行时填充能力表   | 扩展运行器                  |

- **插件（Plugin）**：WorkStudio 的可安装单元，自包含目录 + zip 分发，自带页面并注册资源实现。
- **Extension（Pi 扩展）**：pi 的扩展模块，向注册轴注册会话侧能力。
- 插件与 Pi 扩展分开管理。

### 9.2 插件包

插件是自包含目录，以 zip 分发；一个 zip 只装一个插件。

```text
plugin-docx.zip
├── package.json
├── dist/ura.js
├── dist/page/...
└── node_modules/        # 可选；依赖由插件自己 bundle
```

```json
{
  "name": "@workstudio/plugin-docx",
  "version": "0.3.1",
  "type": "module",
  "exports": { "./ura": "./dist/ura.js" },
  "workstudio": {
    "id": "docx",
    "label": "Word 文档",
    "icon": "file-text",
    "page": "dist/page/index.html",
    "apiVersion": 1
  }
}
```

- `workstudio` 声明身份、页面与 `apiVersion`；`icon` 可为语义名或 favicon。
- `exports["./ura"]` 是 ESM 注册入口：模块求值时调用 `registerXXX`，代码即注册。
- 一个插件最多两个页面：`page`（资源页）与 `settings`（插件设置页）。
- 装配：启动时扫描 `<appData>/plugins/installed/` 与本地路径 → import 入口 → 注册 → 建页面。
- zip 校验：`id` / `version` / 入口 / 页面文件 / `apiVersion`；拒绝路径穿越、符号链接与多插件包。
- 身份以 `workstudio.id` 为准，安装目录也用它；同 id 重复安装覆盖旧版本。

### 9.3 贡献点

| 接口                 | 注册什么                                   | 典型实现               |
| -------------------- | ------------------------------------------ | ---------------------- |
| `registerTransport`  | 协议 → `{ mime, bytes }`；能力在注册时声明 | 本地文件、http(s)      |
| `registerCodec`      | `(transport, mime)` → 文档                 | docx、xlsx、markdown   |
| `registerStore`      | 绑在 codec 上：文档 → 结构化查询           | 表格、邮件             |
| `registerPresenter`  | `(transport, mime, codec)` → 资源页        | 阅读器、编辑器         |
| `registerSidecar`    | `(transport, mime, codec)` → 文本 / schema | 阅读器、数据源         |
| `registerList`       | 列表定义 + 工作区数据 provider             | 文档、网站资料、邮件   |
| `registerViewAction` | 地址栏动作                                 | 布局切换、可访问性标记 |

- 注册在装载期完成；不兼容的注册被拒绝并记诊断。
- **段可以拆开填**：一个插件能只填一段，也能填整条；填哪段由注册接口决定。
- **填段不改身份**：插件只声明能处理什么；ref、绑定表、写队列、脏标记仍归框架。
- 列表定义归 App，数据归 Workspace；插件不能直接改视图集合。

### 9.4 扩展页面与信任

- **资源页**：插件提供 `page`，键为 `(transport, mime, codec)`，只能装载插件目录内资源。
- **插件设置页**：插件提供 `settings`，ref 为 `settings://plugin.<id>`，归设置面。
- 两类页面共用页面协议、preload 桥、主题广播与会话生命周期。

```
主进程（自家）        全量能力
插件（外部）          主进程代码，安装即授权
页面 / 网页（外部）   沙箱渲染进程，无 Node
设置页（自家）        与页面同一沙箱，只能调白名单命令
```

- 信任在安装期：插件能执行主进程代码，来源必须明示。
- 扩展 / 技能同样安装即信任；资源只从 App 私有目录装载，不引入 project trust。
- 运行时靠边界：页面只能走页面数据面；凭证不出主进程；模型侧只拿 schema 与 query。
- 自动化只经侧车：CDP 能力不向页面、插件与命令开放。

### 9.5 安装与生态

**来源**

| 来源 | 写法                                | 落盘                                |
| ---- | ----------------------------------- | ----------------------------------- |
| zip  | `https://.../plugin.zip#sha256=...` | `<appData>/plugins/installed/<id>/` |
| 本地 | 绝对路径 / `./plugins/csv`          | 原地加载，不复制                    |

**插件目录**

```text
<appData>/plugins/
├── registry.md
├── installed.json
├── installed/<id>/
└── staging/
```

**可安装列表是一份 Markdown 文件**：一行一条来源；设置 → 插件页的「可安装」段直接渲染它。远程必须是 zip，并在 URL fragment 带 `sha256`；本地路径仅用于开发。已安装状态不写回清单，由 `installed/` 与 `installed.json` 得出；卸载只删 `installed/<id>`，条目保留。

**安装流程**

```text
读 registry.md
  → 下载到 staging（超时 / 大小上限）
  → 校验 sha256
  → 解压到 staging/<id>-<random>
  → 校验 package.json / workstudio / 入口 / apiVersion
  → 原子替换 installed/<id>
  → 更新 installed.json
  → 下次启动装载
```

- 远程 zip 缺 sha256 拒绝；zip 必须自包含（依赖 bundle 或带 `node_modules`）；安装时不跑 npm。
- 无自动更新：改清单 URL / hash 后重新安装。
- 一个 zip 只装一个插件；`workstudio.id` 是身份与目录名。
- Pi 扩展 / 技能目录在 `<appData>/agent/` 下，与 WorkStudio 插件分开管理。

**三类能力分开管理**

| 分区    | 内容                                 | 页面           |
| ------- | ------------------------------------ | -------------- |
| 插件    | 可安装（zip 清单 md）· 已安装 · 内置 | 设置 → 插件    |
| Pi 扩展 | 社区包安装 / 卸载；已加载 extensions | 设置 → Pi 扩展 |
| 技能    | 技能清单 / 诊断 / 激活集             | 设置 → 技能    |

## 十、系统约束

### 10.1 依赖方向

```
渲染层 → 契约桥 → AppHost
AppHost → AppScope / WorkspaceManager / SessionAdapter
WorkspaceManager → WorkspaceScope → URA / ListService / 视图集合 / 页面会话
SessionAdapter → pi runtime / EventBridge
插件 → 注册面
页面 → 白名单命令
```

| 从             | 允许依赖                                         | 约束                               |
| -------------- | ------------------------------------------------ | ---------------------------------- |
| 渲染层         | 契约桥                                           | 不 import 主进程；无 Node          |
| 契约桥         | AppHost                                          | 只传快照 / 命令 / 事件；来源白名单 |
| AppHost        | AppScope · WorkspaceManager · SessionAdapter     | 组合根；不持业务状态               |
| AppScope       | 系统视图 · 模型 / 凭证 / 插件 / Pi 包 / 全局设置 | 不依赖 Workspace                   |
| WorkspaceScope | 域服务 · URA · ListService · 视图集合            | 不跨工作区复用                     |
| SessionAdapter | pi runtime · EventBridge                         | 不持工作区状态                     |
| 插件           | 注册面                                           | 装载期注册；不持视图句柄           |
| 页面           | 白名单命令                                       | 无 Node / 裸 IPC                   |

### 10.2 失败与降级

| 场景                    | 处理                                                         |
| ----------------------- | ------------------------------------------------------------ |
| 资源无 codec / 解码失败 | 降级 raw + 通用文本投影                                      |
| 页面加载失败 / 崩溃     | 视图进入 error / 待重载；不影响其他视图                      |
| 页面未就绪投递          | 主进程排队，就绪后投递                                       |
| 列表 provider 失败      | 该组 `state = error` + diagnostics；其他组继续               |
| 插件注册冲突            | 后注册者胜出并记诊断；不兼容的注册拒绝                       |
| 工作区切换失败          | 旧作用域已 flush；新作用域失败不半切换，回到工作区列表并报错 |
| 会话切换失败            | 保持当前会话；事件桥不重绑；返回错误                         |
| 文件写入失败            | 写队列返回错误；草稿保留在会话内                             |
| 事件缺口                | 重新 `app.sync` 重建快照，不做增量回放                       |

### 10.3 性能与容量

| 项       | 约束                                             |
| -------- | ------------------------------------------------ |
| 列表     | provider 有返回上限；ListService 负责截断 / 分页 |
| 快照     | 只带当前工作区与会话投影；不序列化全量历史       |
| 事件     | 16ms 合帧；高频增量不逐条渲染                    |
| 视图     | 懒物化；dormant 不建 WebContentsView             |
| 页面     | 关闭即释放；工作区切换全部释放                   |
| 列表刷新 | 去抖；只重建受影响的组                           |
| 大文档   | URA 按需读；sidecar 只取文本 / schema            |

### 10.4 可观测性

- 启动日志记录装配顺序、作用域切换与 epoch。
- 插件注册诊断：冲突、不兼容、列表 provider 错误。
- 列表快照每组带 diagnostics。
- 事件带 seq / epoch，渲染层缺口可追踪。
- 资源降级点：raw、无 codec、页面无出口。

### 10.5 一致性不变量

- **单写者**：状态变更只经 AppHost 命令路径。
- **单快照**：渲染层只持投影；重连以快照为准。
- **纪元单调**：`workspaceEpoch` / `sessionEpoch` 只增不减；旧事件丢弃。
- **作用域隔离**：App 不持工作区数据；Workspace 不持跨工作区缓存；Session 真相在 pi。
- **释放完备**：工作区销毁关闭标签视图、页面会话、写会话、监听器。
- **列表自包含**：`ListSnapshot` 带渲染所需 spec；渲染层不查注册表。
- **空集合兜底**：没有标签时自动打开欢迎页；欢迎页同键唯一，不进入设置列表。
- **私有资源根**：不读写 `~/.pi` 或真实工作区 `.pi`；扩展 / 技能只从 App 管理的目录装载。
- **无 project trust**：安装即信任；工作区只做启用策略，不执行项目目录代码。

## 十一、验收

### 11.1 作用域与切换

1. **App 常驻**：工作区切换后模型、凭证、插件、Pi 包、系统视图仍在。
2. **Workspace 原子替换**：切换后旧标签、旧列表、旧页面会话、旧写草稿全部消失。
3. **Session 委托 pi**：切换会话不重建工作区、不重载资源；只有 session 切片变化。
4. **纪元有效**：旧 `workspaceEpoch` / `sessionEpoch` 的事件不会进入新界面。
5. **单一通道**：渲染层只发 `AppCommand`，只读 `AppSnapshot` / `AppEvent`。
6. **完全隔离**：不读写 `~/.pi` 或真实工作区 `.pi`；所有资源目录在 App 私有数据目录。

### 11.2 列表

1. **结构在 App**：分组、行模板、字段、动作、空态都由 `ListDefinition` 给出。
2. **数据在 Workspace**：`ListSnapshot` 随工作区替换；App 数据列表不随切换销毁。
3. **插件可扩展**：`registerList` 新增的分组无需改渲染层即可出现。
4. **渲染无特例**：Sidebar 没有 docs / web / 临时网页的写死分支。
5. **动作统一**：打开、关闭、固定、删除、插件动作都经 `list.action` 路由。

### 11.3 视图与页面

1. **内容分离**：内容区没有 DOM 承载的标签内容；模态、菜单、拖拽全走原生层。
2. **单管理者**：页面不能创建视图或注册工具；视图崩溃不牵动其他视图与壳层。
3. **布局一致**：窗口缩放、侧栏收放、助手浮动、DevTools 停靠后，DOM 与原生视图边界一致。
4. **恢复**：重建渲染层后，工作区现场、打开集合、激活项、栏宽、主题、助手形态恢复。

### 11.4 资源与管道

1. **管道唯一**：人 / AI / 页面都经 URA；页面无 Node；工具不直连来源。
2. **加载分级**：App 装全局资源，Workspace 装工作区资源，Session 只激活；目录全部 App 私有。
3. **写控制**：同键串行；后写覆盖先写；外部变更经 watch 提示。
4. **表现层可选**：同一文档可按能力选择文本、插件页面或浏览器视图。
5. **浏览器旁路**：网页不进管道；快照已是 Markdown，不经 transport / codec。

### 11.5 扩展

1. **单一扩展体系**：新增能力只经资源轴与注册轴。
2. **填段不改身份**：插件只声明能处理什么；ref、绑定表、写队列、脏标记仍归框架。
3. **页面不越界**：插件页与设置页无 Node、不直连 pi，只拿投影与白名单命令。
4. **生态分离**：插件、Pi 扩展、技能各自安装与管理。
