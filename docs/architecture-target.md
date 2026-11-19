# 目标架构与现状差距

> 本文比较 WorkStudio 已实现的资源/插件架构与目标架构，明确插件前端、codec 插件、transport 插件、URA、传统 UI、Agent 与资源地图之间的边界。本文描述目标，不代表已经实现；当前稳定设计见 [架构设计](./architecture.md)。

## 一、结论

WorkStudio 要融合的两种交互形态不是两套后端，而是同一资源路径上的两个入口：传统 UI（含插件前端）与 Agent。

```text
传统 UI 页面 ───────────────┐
                            ├─► URA ─► codec 插件（上层） ─► transport 插件（下层）
Agent UI 页面 ─► Agent harness ┘
```

插件不是一种东西，而是几类独立贡献，并且后端贡献有上下层：

```text
插件包
├─ codec 插件（主进程）：识别 · 解码 · 编码 · 定位 · 查询 · schema
│   └─ transport 插件（主进程，下层）：来源读取 · 写入 · 列表 · 监听
└─ 插件前端（渲染进程）：页面 · 设置 · 展示与交互
```

codec 插件与 transport 插件是两类后端插件，使用不同的 SDK API；分层上 codec 在 transport 之上，但 codec 不直接 import transport，字节由 URA 的资源管道从下层取得后注入 codec。插件前端通过 workStudio bridge 只与 URA 通讯，不直接连接任何后端插件。

目标判断：

1. **Renderer 是多页面**：传统 UI 页面与 Agent UI 页面分开；插件前端属于传统 UI，不与应用壳层混为一类。
2. **Agent UI 与 Agent harness 是两层**：Agent UI 在 renderer（assistant 等页面），harness 在主进程；传统 UI 页面不经过 harness，直接进入 URA。
3. **codec 插件只面向内存 buffer**：输入是 MIME + bytes，输出是 Document 或新的 MIME + bytes；负责 decode、locate、encode、query、schema、纯数据 view。它不做 IO，不知道来源是本地文件、HTTP 还是其他 transport。
4. **transport 插件只面向来源**：负责字节、列表、监听与写入，不解释 MIME，也不注册 codec。它是独立插件类型，有独立 SDK。
5. **插件前端只做展示**：页面和设置属于插件前端，通过 workStudio bridge 的页面会话契约取数据、保存、重读、关闭。前端不直接调用 codec 插件，也不拿裸 IPC。
6. **URA 是统一入口层**：为传统 UI、插件前端和 Agent harness 提供同一套 `open → operation → projection`；同时维护 Sidecar。MIME 解析与 codec 分发下沉到 codec 层。
7. **资源地图是 URA 的 sidecar**：由资源索引与 codec 描述生成的 Markdown 缓存；Agent 只是消费者，不是 sidecar 的所有者。它不是列表的附属品，也不是独立于 URA 的工作区文件。

## 二、插件模型

### 2.1 三类贡献

| 贡献           | 运行位置       | 负责                                                                      | 不负责                                            |
| -------------- | -------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| codec 插件     | 主进程（上层） | 内存 buffer ↔ Document：MIME、decode、locate、encode、query、schema、view | 来源访问、页面、设置页、Agent 读法、列表、surface |
| transport 插件 | 主进程（下层） | stat / load / commit / list / watch、连接                                 | 解码、编码、页面、Agent 读法                      |
| 插件前端       | 渲染进程       | 页面、设置、展示、交互、编辑体验                                          | 文件读写、格式解释、来源连接、Agent 上下文        |

一个插件包可以同时提供 codec 与前端，也可以只提供其中一类；transport 可以作为独立包存在，也可以由系统内置。三者分别声明、分别注册、分别校验，不共享一个“万能注册面”。

分层与 SDK 是两件事：分层上 codec 在 transport 之上；SDK 上两者完全分开，codec 注册不接收 transport，transport 注册不接收 codec。分层不是 import 关系，字节供给由 URA 的资源管道编排。

### 2.2 前后端不直连

```text
插件前端
  → workStudio bridge
  → URA 页面会话
  → codec 插件
  → transport 插件
  → 来源
```

bridge 连接的是**插件前端 ↔ URA**，不是**插件前端 ↔ codec 插件**。前端发出的打开、保存、重读、关闭都先到 URA；URA 选择 codec、读取 transport、完成操作，再把新的页面投影投递给前端。

- 插件前端只与 URA 通讯，不持有 codec 插件引用。
- codec 插件只被 URA 调用，不向前端发消息。
- transport 插件只被 URA 的资源管道调用，不知道页面与 Agent。
- 插件包只是交付单位，不是运行时边界。

### 2.3 bridge 约束

底层是 `window.workStudio` 的 subscribe / command / notify / onUpdate。插件页面不直接拿完整桥，而是拿资源页面子集；这些调用进入 URA 的页面会话，由 URA 再调用 codec / transport：

| 通道        | 允许                                                               | 不允许                                           |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| 页面会话    | open / get / save / save-copy / reload / close                     | 任意 resources 命令、直接调用 codec 插件         |
| 资源监听    | watch / onChange                                                   | 监听其他工作区或任意文件                         |
| 内容总线    | loaded / content / theme / action / navigate / dirty / save-result | 任意 IPC、Node、文件系统                         |
| 其他 domain | 只读必要的路径展示                                                 | settings / plugins / sessions / windows 等控制面 |

约束的原因：

- bridge 的终点是 URA，不是 codec 插件；前端没有直达后端的 IPC 通道。
- 插件前端不知道资源如何解码，只知道页面会话 id 与页面数据。
- codec 插件不知道谁在显示，只返回格式操作与纯数据。
- 保存、冲突、版本、写队列由 URA 负责，前端不能绕过。
- 插件前端不能借 bridge 获得宿主级能力；页面权限小于应用页面。

### 2.4 页面归属

页面是插件前端资产，不属于 codec 插件注册面：

```text
插件清单
├─ codec 入口：格式操作
├─ frontend：page / settings
└─ transport 入口（可选）：来源访问

插件前端
  → workStudio bridge
  → URA 页面会话
  → codec 插件
```

- codec 插件可以提供 `view` 纯数据，决定“给前端什么数据”。
- 插件前端决定“如何展示这些数据”。
- 页面入口由清单解析，surface → page 的映射由 URA / 视图宿主完成，不再由 codec 的 `presenter` 注册。
- 没有前端页面的格式仍然可以存在：使用通用查看器，或只服务 Agent。

### 2.5 SDK 分层

目标 SDK 按插件类型拆分，不按应用模块拆分：

```ts
// codec SDK
registerCodec(codec: CodecPlugin): void;

// transport SDK
registerTransport(transport: TransportPlugin): void;
```

- `registerCodec` 不接收 transport，不注册页面、Agent 读法、列表或 view action。
- `registerTransport` 不接收 codec，不注册 MIME 解释器。
- 一个包同时包含两类贡献时，分别从各自入口注册；不要在 codec 注册函数里塞来源，也不要在 transport 注册函数里塞格式。
- 系统内置的 file / http(s) 仍然实现 transport 契约，但由系统装配，不经过第三方插件 SDK。

## 三、已实现架构

### 3.1 进程与页面拓扑

```text
Electron main
├─ BrowserWindow（每个工作区一个窗口）
│  ├─ GlobalViews：shell / assistant / overlay / capture
│  └─ Tabs：resource page / plugin page / settings / welcome / web
├─ app:// 内容页协议
├─ IPC：workStudio / extension page session / view bus / capture
└─ 运行时：resources / agent / lists / plugins / updates / settings

Preload
├─ work-studio：shell / assistant / overlay / settings / welcome
├─ extension：资源页 / 插件页（页面会话 + 内容总线）
├─ browser：网页内容视图
└─ capture：交互拖拽期间的指针捕获

Renderer（Vite 多页面）
├─ shell：标题栏 / 侧栏 / 资源面板 / 标签 / 布局
├─ assistant：会话标签 / 消息 / 工具 / 输入
├─ overlay：对话框 / 通知
├─ settings：单页设置卡片
├─ welcome：工作区入口
└─ shared：workStudio / 路径展示 / 列表 / 工作区 / 通知
```

| 页面      | 已实现内容                                                                             |
| --------- | -------------------------------------------------------------------------------------- |
| shell     | 标题栏、工作区切换、侧栏资源树 / 列表、标签栏、原生视图几何、对话框宿主                |
| assistant | 会话标签、消息流、工具块、任务条、thinking / 模型 / 技能、输入与 slash 命令            |
| overlay   | 对话框、通知；受 `dialogs/list` / `notices/list` 驱动                                  |
| settings  | 外观、模型、插件、更新、偏好、技能、资源诊断、存储、工作区、会话、网站、扩展           |
| welcome   | 已登记工作区、目录选择、不可用目录标记                                                 |
| 内容页    | 资源页 / 插件页（`extension`）、网页（`browser`）、设置 / 欢迎页（`settings` preload） |

### 3.2 主进程组合

```text
App（组合根）
├─ Runtime
│  ├─ DomainRegistry
│  ├─ Dispatcher ─► Pipeline
│  ├─ Views ─► GlobalViews / Tabs / ViewProviders
│  ├─ AppViews / AppProviders / AppPages
│  ├─ Native：WindowManager / ThemeManager / Scene / SystemActions
│  ├─ Layout + WindowBindings + Capture
│  └─ Dialogs / Notices / Menu / Policy / Logging
├─ Domains
│  └─ workspaces / resources / settings / updates / lists / plugins
│     sessions / theme / windows / native / scene / layout / dialogs / notices
├─ Modules
│  ├─ agent：host / session / config / models / auth / packages / index / events
│  ├─ ura：registry / pipeline / facade / page sessions / map / sidecar / sdk
│  ├─ resources：resource service
│  ├─ sessions：session projection / task / tabs
│  ├─ lists：registry / providers / snapshot
│  ├─ plugins：source / install / catalog / host / service
│  ├─ browser：features
│  ├─ harness：skills / prompts / URA tools / browser tools / office tools
│  ├─ sites：snapshots
│  └─ updates：updater / service
└─ Infrastructure
   ├─ net / proxy
   ├─ repo / workspaces
   ├─ preferences / data-root / paths / path-codec
   ├─ window-state / log
```

| Runtime 模块      | 已实现职责                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| 组合根 App        | 进程启动 / 停止、窗口打开 / 关闭、工作区切换、资源与 Agent 延迟初始化、domain 发布、主进程 IPC                   |
| DomainRegistry    | domain / resource 定义；snapshot / command / notify；视图订阅与 update 投递                                      |
| Dispatcher        | sender → origin → Pipeline；区分 shell 窗口与内容视图                                                            |
| Pipeline          | middleware 链、domain 路由、错误包装、update 分发                                                                |
| Views             | GlobalViews（系统视图）与 Tabs（内容标签）；WebContentsView 挂载、记录、激活、固定、脏态、缺失、冲突、复用与释放 |
| ViewProviders     | `resource` / `settings` / `plugin` / `web` / `welcome` 五种 target 的页面规格解析                                |
| AppViews          | 资源 / 网页 / 设置 / 插件 / 欢迎页打开；另存副本；系统视图创建                                                   |
| Native            | BrowserWindow、标题栏、主题、scene、系统动作、菜单、窗口状态                                                     |
| Layout            | 窗口尺寸 + scene + interaction preview → DOM / 原生视图矩形                                                      |
| WindowBindings    | 每窗口 `scene/<wsId>`、`layout/<wsId>`、拖拽捕获层、blur 提交                                                    |
| Dialogs / Notices | 对话框、通知的应用级 UI 状态                                                                                     |
| AppPages          | `app://` 内容页协议与静态页服务                                                                                  |
| Policy / Logging  | webContents 加固、导航 / 权限策略、诊断日志                                                                      |

### 3.3 Domains 与资源

| Domain            | Resource                                                                                                                          | 已实现内容                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| workspaces        | `list` / `current`                                                                                                                | 工作区列表、打开、关闭、重命名、移除、当前工作区                             |
| resources         | `current`                                                                                                                         | 资源读写、编辑、查询、树、监听、页面会话、打开页面 / 网页、另存副本、刷新    |
| settings          | `pages` / `appearance` / `storage` / `browser` / `skills` / `preferences` / `models` / `advanced` / `extensions` / `resourceInfo` | 设置页元数据、外观、存储、白名单、技能、偏好、模型、URA 绑定、扩展、资源诊断 |
| updates           | `status`                                                                                                                          | 更新检查、下载、取消、打开安装包                                             |
| lists             | `current`                                                                                                                         | 侧栏列表快照、刷新、打开列表项                                               |
| plugins           | `list` / `installed` / `catalog` / `task`                                                                                         | 插件清单、已安装来源、目录、安装任务与设置                                   |
| sessions          | `current` / `list` / `models` / `commands` / `active` / `task` / `opened` / `thinking` / `skills`                                 | 当前会话、列表、模型、slash 命令、流式消息、任务、标签、思考档位、技能选择   |
| theme             | `current`                                                                                                                         | light / dark / system、有效主题                                              |
| windows           | `list`                                                                                                                            | 窗口集合、聚焦、关闭、打开、窗口移动                                         |
| native            | `app`                                                                                                                             | 打开路径 / 外链、目录选择、保存文件、菜单                                    |
| scene             | `<wsId>`                                                                                                                          | 每窗口现场补丁                                                               |
| layout            | `<wsId>`                                                                                                                          | 布局快照、交互 begin / move / end / cancel                                   |
| dialogs / notices | `list`                                                                                                                            | 对话框与通知队列                                                             |

### 3.4 Modules

| Module    | 子模块与职责                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| agent     | 运行时启动、pi session、模型目录 / 认证 / 配置、包安装、会话索引与列表、事件桥、UI 上下文、工作区资源           |
| ura       | transport 注册、codec / store / presenter / sidecar 注册、资源管道、门面、页面会话、资源地图、绑定、写会话、SDK |
| resources | `ResourcesService`：资源业务门面、页面会话视图、资源监听、缺失状态、页面变更事件                                |
| sessions  | `SessionsService`：会话列表、打开标签、消息、流式投影、任务状态、fork / retry / abort、模型 / 思考档位          |
| lists     | 列表定义注册、provider、builtins（docs / temp / sessions / plugins / settings / file-time）、snapshot 构建      |
| plugins   | 插件来源、下载 / 校验 / 安装、catalog、插件包解析、插件宿主、插件业务、内置插件表                               |
| browser   | 浏览器能力注册、视图动作、导航与 a11y 动作                                                                      |
| harness   | 技能、prompt、URA 工具、浏览器工具、Office 工具、内置扩展、技能播种                                             |
| sites     | 白名单网页快照                                                                                                  |
| updates   | updater、更新状态服务、下载任务                                                                                 |

### 3.5 Infrastructure

| Module             | 职责                                  |
| ------------------ | ------------------------------------- |
| net                | 代理与出站 HTTP                       |
| repo               | 工作区注册持久化                      |
| preferences        | 用户偏好、工作区策略、浏览器白名单    |
| data-root          | 数据根初始化与切换                    |
| paths / path-codec | 应用路径、工作区路径、资源 ref 编解码 |
| window-state       | 窗口尺寸 / 位置记忆                   |
| log                | 诊断日志                              |

### 3.6 通讯链路

```text
shell / assistant / overlay / settings / welcome
  → preload work-studio
  → workStudio.subscribe / command / notify
  → Dispatcher → Pipeline → Domain
  → snapshot / patch / event
  → workStudio.onUpdate

资源页 / 插件页
  → preload extension
  → 页面会话命令（open / get / save / save-copy / reload / close）
  → resources domain → URA → PageSessions
  → CH_BUS（content / theme / action / navigate / dirty / save-result）
  → CH_URA_WATCH（资源变更）

网页
  → preload browser
  → WebContentsView 原生导航

拖拽
  → capture preload
  → CH_CAPTURE
  → layout preview → scene patch
```

| 通道       | 已实现语义                                                                         |
| ---------- | ---------------------------------------------------------------------------------- |
| workStudio | `(domain, resource)` 订阅；有回复 command；无回复 notify；snapshot / patch / event |
| extension  | 资源页 / 插件页的受限页面会话；preload 内部转到 resources domain                   |
| view bus   | 内容投递、主题、动作、导航、脏态、保存结果、页面日志                               |
| URA watch  | 页面打开后订阅资源变更，主进程按 sender 回推                                       |
| capture    | 交互期间捕获指针，结束 / blur / cancel 收敛 scene                                  |
| app://     | 资源页 / 插件页 / 设置 / 欢迎页的静态入口与页面会话参数                            |

### 3.7 资源与插件运行时

```text
ensureResources
├─ PluginService（安装来源 / 包目录）
├─ PluginCatalog（社区目录）
├─ createUraRuntime
│  ├─ 系统 transport：file / http / https
│  ├─ PluginHost
│  │  ├─ 内置插件：markdown / text / html
│  │  ├─ 已安装插件：动态装载
│  │  ├─ URA SDK：codec / store / presenter / sidecar / transport / view action
│  │  └─ 列表注册表
│  ├─ BindingStore
│  ├─ ResourcePipeline（缓存 / 写队列 / watch）
│  ├─ Ura 门面（read / write / edit / query / tree / watch）
│  ├─ PageSessions
│  ├─ ListContexts
│  └─ ResourceMap（列表 provider → AGENTS.md）
├─ PluginsService（安装任务 / 取消 / 重试 / 卸载）
└─ ResourcesService（页面视图 / 监听 / 缺失 / 刷新）
```

| 组成部分   | 已实现职责                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 插件来源   | 本地目录 / zip / 远程包，下载、校验、安装、共享 id 处理                                            |
| 插件包     | package.json 清单、page / settings、`./ura` 注册入口、技能声明、图标                               |
| 插件宿主   | 扫描包、置入归属、执行注册入口、热安装 / 热卸载、加载错误与诊断                                    |
| URA 注册表 | transport / codec / store / presenter / sidecar / view action 的注册、解析、绑定、诊断、owner 撤销 |
| URA 管道   | 来源读取、MIME 解析、codec 解码、缓存、按 ref 串行写、watch 失效、降级 raw                         |
| URA 门面   | read / write / edit / ls / find / grep / query / tree / watch / 页面投影                           |
| 页面会话   | 打开 → 就绪 → 投递 → 脏态 / 保存 / 重载 → 关闭；同 ref 复用页面                                    |
| 资源地图   | 从列表 provider 收集条目 + schema，写工作区 `AGENTS.md`，harness 读取注入                          |
| 列表运行时 | 内置 provider + 插件列表 provider → `ListSnapshot` → `lists/current`                               |

### 3.8 Agent / 会话 / Harness

```text
AgentHost
├─ pi runtime / session
├─ 模型配置 / 认证 / 目录
├─ 包与服务（pi packages）
├─ 技能管理
├─ built-in extensions
└─ harness extension
   ├─ URA tools：read / write / edit / grep / find / ls / query
   ├─ browser tools：open / read / click / type / back / screenshot / snapshot
   ├─ office tools：pptx / docx / xlsx
   └─ context hook：资源地图注入

SessionsService
├─ 当前会话 / 列表 / 打开标签
├─ 消息与流式投影
├─ 任务状态 / 停止 / 重试 / fork
└─ 模型 / 思考档位 / 技能选择
```

| 部分         | 已实现职责                                                                       |
| ------------ | -------------------------------------------------------------------------------- |
| Agent 运行时 | pi 会话生命周期、工作区 cwd、资源加载、扩展装入、模型切换、登录 / 登出           |
| 会话服务     | 会话索引、消息、流式帧、任务状态、打开标签、fork / retry / abort、重命名 / 删除  |
| Harness      | URA 工具、浏览器工具、Office 工具、技能、系统 prompt、资源地图上下文注入         |
| 助手页       | 会话标签、消息渲染、工具块、任务条、模型 / 思考 / 技能选择、slash 命令、输入队列 |
| 事件桥       | pi 事件 → 会话服务投影 → `sessions/active` / `sessions/task` 更新                |

### 3.9 列表 / 设置 / 更新 / 浏览器

| 部分   | 已实现职责                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------- |
| 列表   | 文档、临时文件、会话、插件、设置、文件时间 provider；统一分组 / 字段 / 动作 / 空态；当前视图状态回写 |
| 设置   | 单页卡片；registry 生成页面元数据；卡片消费 settings / updates / plugins domain；无 iframe           |
| 更新   | 独立更新状态机；设置卡片消费 `updates/status`                                                        |
| 浏览器 | 白名单、站点快照、链接 / 导航、a11y 动作、页面内新标签、窗口打开拦截                                 |
| 站点   | 白名单站点快照 Markdown 落入工作区；快照服务 sidecar                                                 |

### 3.10 工作区与生命周期

| 阶段             | 已实现行为                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 打开工作区       | 设置 current → 创建窗口 → 创建 shell / assistant / overlay / 必要 welcome → 异步初始化 resources / agent                        |
| resources 初始化 | 插件来源 / catalog → URA runtime（系统 transport、插件宿主、绑定、管道、页面会话、资源地图）→ PluginsService → ResourcesService |
| agent 初始化     | 工作区 cwd / 技能禁用集 → AgentHost → 模型配置 → package service → SessionsService                                              |
| 工作区切换       | 更新 current → 旧窗口延迟关闭 → 重置 resources / agent → 重载列表 / 设置 / 会话                                                 |
| 关闭窗口         | 释放全部视图订阅 → 清空 global / tabs → 若为 current 则清空 resources 运行时                                                    |
| 退出             | 解除 IPC、关闭全部窗口、销毁视图、停用 pipeline                                                                                 |
| 外观             | appearance 持久化 → theme / zoom 应用到窗口与内容视图                                                                           |

### 3.11 当前边界问题

**插件注册面把 codec 与 transport 混在一起**

当前插件后端注册面同时包含来源访问与格式解释：

| 注册项             | 实际语义                | 应该归属                           |
| ------------------ | ----------------------- | ---------------------------------- |
| transport          | 来源访问                | transport 插件（独立 SDK）         |
| codec              | 类型解码 / 编码 / 定位  | codec 插件                         |
| store              | 类型查询 / schema       | codec 插件                         |
| presenter          | 页面 surface + 页面数据 | 拆成 codec view 数据与前端页面入口 |
| sidecar            | Agent 读法              | URA 的 Agent 投影                  |
| list / view action | 列表与工具条            | 应用 UI / 插件前端                 |

结果是同一个 SDK 里既有“字节从哪里来”，又有“字节如何解释”，还有“谁来展示”。插件无法只按数据类型实现。

**codec 键带 transport**

当前 codec 用 `(transport, mime)` 作为匹配键，导致格式实现被迫知道来源类型。一个 Markdown codec 不应该关心它读的是本地文件还是 HTTP；它只应关心 MIME 与扩展名。

**URA 更像注册表分发器，而不是融合层**

当前 URA 已经让人和 Agent 共用门面，但差异被下沉到了插件：

- UI 走 `editor` 投影，取 presenter；
- Agent 走 `agent` 投影，取 sidecar；
- 两个投影分别由插件注册；
- UI 页面会话和 Agent 工具各自维护读写上下文。

统一只发生在“都调用 URA”，没有发生在“同一条操作语义”。

**sidecar 被当成 Agent 专属出口**

旧模型把 sidecar 理解为“Agent 读取面”，于是资源地图也被当成 Agent 侧产物。这个归属不对：sidecar 是 URA 管理的派生资源，Agent 只是消费者之一。

**资源地图与 URA 的主路径分离**

资源地图目前：

- 数据源是列表 provider，而不是资源索引或 codec 注册表；
- 产物是工作区根部的 `AGENTS.md`；
- 由 harness 作为文件读取并注入上下文；
- 不在 URA 的 sidecar 注册面中；
- 列表还要显式排除这个文件。

因此它更像“列表的导出物”，不是“URA 对 Agent 的投影”。

**装配方向不够干净**

URA 运行时的创建过程同时创建插件宿主；插件 SDK 还能注册列表和 transport。这使 URA 同时知道插件包、来源注册、列表与页面 surface，难以保持“资源内核”单一职责。

## 四、目标架构

### 4.1 分层

```text
┌─ Renderer：多页面 ──────────────────────────────────────────────┐
│ ┌─ 传统 UI 页面 ──────────────┐  ┌─ Agent UI 页面 ─────────────┐ │
│ │ shell / settings / welcome  │  │ assistant                   │ │
│ │ 插件前端（资源 / 设置页）   │  │ 会话 / 消息 / 输入          │ │
│ └──────────────┬──────────────┘  └──────────────┬─────────────┘ │
└────────────────┼─────────────────────────────────┼──────────────┘
                 │ bridge：命令 ↓ / 更新 ↑         │ bridge：prompt ↓ / 事件 ↑
                 │                                 ▼
                 │                    ┌─ Agent harness（第二层） ─┐
                 │                    │ tools / context / prompts │
                 │                    └─────────────┬─────────────┘
                 ▼                                  ▼
┌─ URA 统一入口层（第三层） ───────────────────┬─ Sidecar ─────────┐
│ 统一入口：传统 UI / Agent Harness           │ 资源地图          │
│ 资源会话 · 操作接口 · Sidecar 维护          │ Markdown 缓存     │
│ 写队列 · UI / Agent 投影                    │ 版本 / 失效       │
└──────────────────────────┬──────────────────┴───────────────────┘
                           │ 抽象上层：请求 ↓ / 返回 ↑
┌──────────────────────────▼───────────────────────────────────────┐
│ codec 插件（第四层）                                             │
│ 输入：mime + bytes（内存 buffer）                             │
│ MIME 双向分发 · decode / encode · schema · view data             │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 抽象下层：load/commit ↓ / mime + bytes ↑
┌──────────────────────────▼───────────────────────────────────────┐
│ transport 插件（第五层）                                         │
│ 输出：mime + bytes（来源读取）                                │
│ stat · load · commit · list · watch · 连接                       │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
                         来源
```

Agent UI 与 harness 是两层：Agent UI 在 renderer（assistant 等页面），harness 在主进程。传统 UI 页面与 Agent UI 页面虽然同在 renderer 进程，但不是同一条调用链：传统 UI 页面直接通过 workStudio bridge 进入 URA；Agent UI 通过 sessions domain 交给第二层 harness，再由 harness 的工具进入 URA。

URA 框内右侧是 sidecar 区，与左侧资源内核同层：资源地图不是下层模块，也不是独立于 URA 的外部文件。

图里的下箭头表示**抽象层级 / 依赖方向**，不表示通讯只有单向。运行时每条边都是双向的：

| 边界            | 下行                  | 上行                        |
| --------------- | --------------------- | --------------------------- |
| Renderer ↔ URA  | command / open / save | snapshot / patch / event    |
| URA ↔ codec     | decode / execute      | document / operation result |
| URA ↔ transport | load / commit         | mime + bytes / 写结果       |

codec 不直接调用 transport：URA 先从下层 `load` 取得 `mime + bytes`，再交给 codec 解释。因此“codec 在 transport 之上”是抽象层级，不是 codec 对 transport 的直接依赖。

分层表达抽象层级与供给关系，不表达 import 或直接调用：codec 不持有 transport；URA 从下层取得 `mime + bytes`。这一版目标契约先不引入资源版本，版本问题不进入 transport → codec 的接口。SDK 仍然分开设计。

### 4.2 codec 插件契约

codec 插件是纯内存格式适配器：只面对 `mime + bytes` 与 `Document`，在内存中完成 decode / encode。MIME / 格式语义归 codec；它不做文件或网络 IO，不知道 transport，不知道 UI，也不知道 Agent，也不负责从注册表中挑选自己。

```ts
interface CodecPlugin {
  id: string;
  /** 只按 MIME / 扩展名匹配，不携带 transport。 */
  mimes: readonly Mime[];
  extensions?: readonly string[];
  schema?: unknown;

  decode(raw: RawResource): Promise<Document> | Document;
  locate?(doc: Document, anchor: Anchor): Span;
  encode?(doc: Document, change: Change): Patch;
  query?(doc: Document, query: Query): unknown;

  /** 核心操作特化；缺省使用 URA 的通用实现。 */
  core?: Partial<Record<CoreOperation, CommandHandler>>;
  /** 类型专属命令；名称必须命名空间化。 */
  commands?: readonly CodecCommand[];
  /** 纯数据视图：给前端页面消费；不生成 HTML，不注册页面。 */
  view?(doc: Document): ViewData;
  /** 纯数据投影：文本 / 结构化摘要；不知道调用者是谁。 */
  extract?(doc: Document): string | StructuredData;
  /** 类型描述：schema 与可用操作，不含行数据。 */
  describe?(doc: Document): ResourceDescriptor;
}
```

约束：

- `Document` 对 URA 是不透明结构；插件内部可以有自己的 AST。
- `mimes` / `extensions` 只描述格式；codec 不读取 transport id，也不知道来源协议。
- `core` / `commands` 声明操作能力；没有 `encode` 就是只读类型。
- 文档级 `read` / `write` 属于 codec：`read` 由 decode + extract 组成，`write` 由 encode 的整篇替换实现，`edit` 由 encode 的锚定替换实现。
- `view` 只返回数据，不返回页面、不决定 surface；页面入口由插件清单声明。
- `extract` 是纯数据操作：只把文档变成文本/结构，不渲染页面，也不知道消费者是 UI 还是 Agent。
- `schema` 是数据对象对 Agent 的公开结构，不包含行数据。
- codec 插件不出现 `transport`、`page`、`presenter`、`sidecar`、`list`、`surface`。

### 4.3 transport 插件契约

transport 插件是纯来源适配器：处理连接、来源元数据与字节搬运；它把来源内容读成 `mime + bytes`，把 buffer 写回来源，但不解释 MIME，也不执行 codec。

```ts
interface RawResource {
  /** MIME 必填；transport 负责解析来源元数据。 */
  mime: Mime;
  bytes: Uint8Array;
}

interface TransportPlugin {
  id: string;
  schemes: readonly string[];
  capabilities: readonly TransportCapability[];

  stat(ref: string): Promise<ResourceStat>;
  /** 字节级读取；产出 MIME 类型的资源，不承担文档语义的 read。 */
  load(ref: string): Promise<RawResource>;
  /** 字节级提交；不承担文档语义的 write。 */
  commit(
    ref: string,
    patch: Patch,
    options: TransportWriteOptions,
  ): Promise<TransportWriteResult>;
  list(ref: string): Promise<ListEntry[]>;
  watch?(ref: string, emit: (event: ChangeEvent) => void): () => void;
}
```

约束：

- transport 返回 MIME 与字节，不选择 codec；资源版本不在这一层考虑。
- `load` / `commit` 是字节级原语；文档级 `read` / `write` 属于 codec，避免两层共享同一操作名。
- transport 不注册 store、presenter、sidecar、list 或页面。
- `live` 能力表示来源本身是实时页面；是否旁路浏览器由 URA 的来源策略决定，不进入 codec。
- 内置 file / http(s) 与第三方 transport 使用同一契约，但系统内置来源由组合根装配。

### 4.4 codec 层与 MIME 双向分发

URA 只定义统一资源接口；MIME 匹配、codec 选择与编码方向的分发都属于 codec 层。codec 层只做内存中的 buffer ↔ document 变换，不接触来源。

```ts
interface DecodedResource {
  /** 入向命中的 codec；raw 降级时为空。 */
  codec: string | null;
  mime: Mime;
  document: Document;
}

interface CodecHint {
  ref?: string;
  extension?: string;
}

interface CodecSession {
  codec: string;
  mime: Mime;
  document: Document;
}

interface CodecLayer {
  /** 入向：mime + bytes → codec → Document。 */
  decode(raw: RawResource, hint?: CodecHint): Promise<DecodedResource>;

  /** 出向：Document 变更 → 同一 codec → RawResource。 */
  encode(session: CodecSession, change: Change): Promise<RawResource>;
}
```

codec 层内部包含：

```text
codec 层
├─ codec 注册表（mimes / extensions）
├─ MIME 匹配
├─ 用户绑定、优先级、冲突诊断
├─ decode 分发（入向）
├─ encode 分发（出向）
└─ codec 插件（各格式实现）
```

职责表：

| 步骤                                 | 归属      |
| ------------------------------------ | --------- |
| 从 Content-Type / 扩展名产出 `mime`  | transport |
| MIME / 格式语义与 `mimes` 声明       | codec 层  |
| mime → codec 选择                    | codec 层  |
| decode（RawResource → Document）     | codec 层  |
| encode（Document → RawResource）     | codec 层  |
| raw 降级、优先级、冲突诊断           | codec 层  |
| 资源会话、操作接口、投影、写队列编排 | URA       |

两个方向都是纯内存变换，由 codec 层收口：

```text
读：mime + bytes → codec 层 resolve → codec.decode → Document
写：Document + Change          → codec 层 resolve → codec.encode → RawResource
```

URA 不再知道“哪个 MIME 对应哪个 codec”，只调用 `CodecLayer.decode` / `encode`。transport 提供 MIME 与字节，也不参与 codec 选择。

规则：

- **URA 是接口**：只定义 `open` / `describe` / `project` / `execute`，不持有 MIME 分发逻辑。
- **codec 层是分发器**：MIME 匹配、绑定、优先级、双向 encode/decode 都在这里。
- **codec 插件是实现**：只声明 `mimes` 与格式操作，不查询全局注册表。
- **MIME 必填**：transport 必须给出 `mime`；codec 层可校验或细化，但不会凭空猜测。
- **无匹配**：codec 层返回 raw 降级结果；URA 只消费结果，不自行判断格式。
- **纯内存**：codec 层不做文件 / 网络 IO，不持 ref / version / 句柄；需要关联资源时由 URA 预取并以 buffer 注入。
- **live 页面**：仍由 URA 的来源策略在进入 codec 层前旁路。

### 4.5 操作注册与融合

codec 会有很多操作：`read`、`write`、`grep`，Office 还可能有几百个命令。不能把它们变成 URA 的几百个方法，也不能给 Agent 生成几百个工具。

统一成两类操作：

| 类型     | 名称                                                         | 归属       | 说明                                                   |
| -------- | ------------------------------------------------------------ | ---------- | ------------------------------------------------------ |
| 核心操作 | `read` / `write` / `edit` / `grep` / `find` / `ls` / `query` | URA 定义   | 语义固定；codec 可通过 `core` 提供特化，缺省由原语组合 |
| 类型命令 | `office.slide.add` 等命名空间命令                            | codec 定义 | 描述 + handler；由 URA 统一执行                        |

```ts
type CoreOperation =
  | 'read'
  | 'write'
  | 'edit'
  | 'grep'
  | 'find'
  | 'ls'
  | 'query';

type CommandHandler = (
  ctx: CodecContext,
  input: unknown,
) => Promise<OperationResult> | OperationResult;

interface OperationDescriptor {
  /** 核心名，或命名空间命令名，如 office.slide.add */
  name: string;
  title: string;
  description?: string;
  input: JsonSchema;
  output?: JsonSchema;
  mutates?: boolean;
  danger?: 'safe' | 'confirm' | 'destructive';
  /** 工具暴露层级；默认 hidden，由 harness 按策略映射。 */
  exposure?: 'direct' | 'deferred' | 'hidden';
}

interface CodecCommand {
  descriptor: OperationDescriptor;
  execute: CommandHandler;
}

interface CodecContext {
  ref: string;
  mime: Mime;
  codec: string;
  document: Document;
  /** 受控写回：自定义命令也走 URA 写队列。 */
  commit(patch: Patch): Promise<void>;
  signal?: AbortSignal;
}

interface OperationResult {
  data?: unknown;
  /** 有变更时返回补丁，由 URA 统一提交。 */
  patch?: Patch;
}
```

融合规则：

- **一个执行入口**：UI 动作、插件前端和 Agent 都调用 `resources.execute(session, operation, input)`，不直接调用 codec 方法。
- **一份描述**：`resources.describe(session)` 返回核心操作和类型命令的 `OperationDescriptor[]`；UI 表单、工具栏和 Agent 工具共用这份描述。
- **核心操作优先**：`read` / `write` / `edit` / `grep` / `find` / `ls` / `query` 是保留名；codec 可在 `core` 中特化，不能注册同名自定义命令。
- **类型命令必须命名空间化**：例如 `office.slide.add`、`office.sheet.set-cell`；禁止裸名，冲突进诊断。
- **写操作统一收口**：命令返回 `patch` 或调用 `ctx.commit`，都经过 URA 的串行写队列和冲突处理；本版不引入资源版本。
- **输入输出有 schema**：`input` / `output` 用 JSON Schema 描述；URA 在执行前校验，不把参数解析散落在每个命令里。
- **危险操作可声明**：`danger` / `mutates` 供 UI 确认和 Agent 审批共用。
- **默认实现可退化**：codec 没有特化核心操作时，URA 用 `decode` / `encode` / `extract` / `query` 组合；没有声明的命令不出现。

#### Pi 文本工具是适配器，不是资源模型

这里确实有一个矛盾：Pi 内置工具是“文本编辑”思维，URA 的资源操作是“类型化命令”思维。解决方式不是把 Office 命令硬塞进 `read/write/edit`，而是承认两层工具面：

| 工具            | 文本资源     | Office / 结构化资源                     |
| --------------- | ------------ | --------------------------------------- |
| `read`          | 文本         | 通过 `extract` 得到 Markdown / 文本摘要 |
| `write`         | 整篇写入     | 不伪造文本写入；使用类型命令            |
| `edit`          | 锚定文本替换 | 不伪造文本编辑；使用类型命令            |
| `grep`          | 文本检索     | 对 `extract` 后的文本检索               |
| `find` / `ls`   | 资源发现     | 资源发现                                |
| `query`         | 结构化数据   | schema / store                          |
| `resource.exec` | 可选         | `office.slide.add` 等类型命令           |

规则：

- `read` 可以是通用投影，因为 Agent 读的是文本 / Markdown，不是原始二进制。
- `write` / `edit` 只有在 codec 明确支持文本写入时才暴露；Office 不暴露这两个工具。
- `grep` 依赖 `extract`；没有文本投影就不出现。
- `query` 依赖结构化 store；没有 store 就不出现。
- 类型命令走 `resource.exec`，不伪装成 `write` / `edit`。
- `describe(session)` 的 operations 决定工具是否出现；不存在的能力不显示，避免模型误用。

因此，URA 的资源模型是统一的；Pi 的文本工具只是其中一种**投影适配器**。两者不是同一个抽象层。

Agent 侧不需要为每个命令生成一个工具：

- 核心操作保留稳定语义；Agent 只暴露当前资源支持的那些：`read` 通常可用，`grep` 依赖 extract，`write` / `edit` 仅文本可写，`query` 依赖 store。
- 类型命令通过一个通用 `resource.exec` 工具执行：`{ ref, operation, input }`。
- 资源地图只列出操作命名空间与命令摘要；完整 schema 由 `describe(session)` 按需读取，避免把 Office 的几百个 schema 全塞进上下文。
- UI 用同一份 `OperationDescriptor[]` 生成动作、表单和确认提示。

工具暴露分层：

| exposure   | 暴露方式                                                    | 适用                        |
| ---------- | ----------------------------------------------------------- | --------------------------- |
| `direct`   | 直接声明给模型，每轮可见                                    | 7 个核心操作、极高频命令    |
| `deferred` | 不直接声明；通过 tool search / `describe` 发现后调用        | 低频但有明确语义的命令      |
| `hidden`   | 不进入工具列表；只通过通用 `resource.exec` 或 codemode 调用 | Office 等大量命令、批量操作 |

默认策略：

- 7 个核心资源工具保持 `direct`；
- codec 的类型命令默认 `hidden`，统一走 `resource.exec`；
- 确有高频价值的少数命令可提升为 `direct`；
- 需要检索的场景使用 `deferred`，把命令描述与分组放进搜索索引；
- 不要把“每个 Office 命令 = 一个工具”。

可直接映射到 Pi 的现有能力：

- `deferred` 对应 Pi 的 tool search / deferred tool exposure；
- `hidden` 对应 codemode 或通用执行器；
- 资源地图对应 progressive disclosure：先给目录与命名空间，再按需 `describe`。

业界参考：lark-cli

`@larksuite/cli` 有 200+ 命令和 26 个 Skills，但没有给 Agent 暴露 200+ tools。它的做法是三层命令系统：

```text
Shortcuts（+agenda / +messages-send）
  → API Commands（1:1 OpenAPI 方法，自动生成）
  → Raw API（api GET/POST，覆盖 2500+ 接口）
```

Agent 只通过一个 shell / exec 工具调用 `lark-cli`，命令发现依赖：

- `--help` / `schema` 查看命令与参数；
- Skills 做领域路由与工作流；
- afforance 文档补充 when / 示例 / 风险；
- 结构化 JSON 输出与类型化错误。

对应到 WorkStudio：

| lark-cli               | WorkStudio                         |
| ---------------------- | ---------------------------------- |
| shell 执行 `lark-cli`  | `resource.exec`                    |
| Shortcuts              | 7 个核心工具 + 少量高频命令        |
| API Commands / Raw API | 命名空间化的 codec 命令            |
| `schema` / `--help`    | `OperationDescriptor` / `describe` |
| Skills                 | 资源地图 + 技能 + 上下文目录       |

Office 的例子：

```text
codec: office/pptx
commands:
  office.slide.add
  office.slide.delete
  office.slide.reorder
  office.text.set
  office.export.pdf
```

这些命令由同一个 `resources.execute(session, ...)` 分发，和 `read` / `write` 一样经过 URA 的队列与审计。

```ts
resources.execute(session, 'office.slide.add', { title: 'Summary' });
```

### 4.6 插件前端契约

插件前端是展示层，消费 URA 的 UI 投影：

```ts
interface PageSpec {
  sessionId: string;
  ref: string;
  mime: Mime;
  codec: string | null;
  surface: string;
  page: string;
  data: ViewData;
  actions: readonly OperationDescriptor[];
  editable: boolean;
}
```

前端通过受约束 bridge 使用，这些调用都落在 URA 页面会话上：

```text
openPage(ref) → URA → codec decode → PageSpec
getPage(sessionId) → URA 当前投影 → PageSpec
savePage(sessionId, content) → URA → codec encode → 保存
reloadPage(sessionId) → URA 重新投影 → PageSpec
closePage(sessionId) → 释放页面会话
```

页面总线负责内容投递、就绪、脏态、动作、导航与保存结果。前端不直接调用 codec 插件的任何方法；后端变化通过 URA 重新投影、经页面会话体现。

### 4.7 URA 统一入口与 Sidecar

URA 的重点是两件事：

1. **统一入口**：传统 UI、插件前端和 Agent harness 使用同一套 `open / describe / project / execute / watch`；`catalog.describe(scope)` 负责逐层发现，不各自维护读取器。
2. **维护 Sidecar 与搜索面**：资源地图、单资源文本摘要等派生资源由 URA 生成、版本化、失效和物化；搜索负责召回地图摘要之外的语义。

MIME 匹配与 codec 分发在 codec 层；URA 只调用 codec 层，不持有 MIME 分发逻辑。

```ts
interface ResourceSession {
  ref: string;
  /** transport 提供、codec 层确认的 MIME。 */
  mime: Mime;
  /** 实际命中的 codec；raw 降级时为空。 */
  codec: string | null;
  document: Document;
  capabilities: readonly OperationDescriptor[];
}

type ProjectionKind = 'ui' | 'agent';

interface ResourceDescriptor {
  ref: string;
  mime: Mime;
  codec: string | null;
  operations: readonly OperationDescriptor[];
}

interface ResourceGateway {
  open(ref: string): Promise<ResourceSession>;
  describe(session: ResourceSession): Promise<ResourceDescriptor>;
  project(
    session: ResourceSession,
    kind: ProjectionKind,
    options?: { detail?: 'summary' | 'full' },
  ): Promise<PageSpec | AgentProjection>;
  execute(
    session: ResourceSession,
    operation: string,
    input: unknown,
  ): Promise<OperationResult>;
  watch(ref: string, listener: (change: ChangeEvent) => void): WatchHandle;
}
```

统一流程：

```text
ref
 → URA.open
 → transport 插件 load → mime + bytes
 → codec 层 decode（MIME / codec 分发在这里）
 → ResourceSession
     ├─ project(ui)    → PageSpec / 页面会话 / 插件前端
     └─ project(agent) → Markdown / 结构化结果
 → resources.describe(session) → 核心操作 + 类型命令
 → execute(operation) → 同一写队列、冲突处理、审计
 → Sidecar：资源地图 / 文本摘要按需生成、版本化、失效
```

关键点：

- **同一入口**：传统 UI、插件前端和 Agent harness 的工具都从 `open` 开始，不允许 Agent 另走一套读取器。
- **同一操作语义**：read / write / edit / query 的队列、错误和审计一致；版本不在本版契约内。
- **投影后置**：调用者差异只发生在 `project`，不进入 codec 插件，也不改变资源结果。
- **页面会话是 ResourceSession 的前端投影**：插件前端长期持有 session；Agent harness 可以短生命周期打开。
- **操作能力来自 codec 描述**：UI 工具条、Agent 工具可用性和资源地图共享同一份 `operations`。
- **前端不碰后端**：插件前端只消费 PageSpec 与页面会话，不能 invoke 类型操作。
- **bridge 不穿透 URA**：页面会话的终点是 URA，不是 codec 插件；所有读写先经过操作内核。

### 4.8 资源地图

资源地图是 URA 的**工作区级必需 sidecar**，不是可选缓存，也不是操作目录。它负责让 Agent 先理解“这个工作区里有什么业务资源”，再决定打开哪一个、执行什么操作。

```text
资源索引（ref / MIME / codec / 标题 / 摘要 / 能力分组）
        │
        ▼
resource-map sidecar（Markdown）
        │
        ├─ Agent 上下文注入
        └─ 物化为 AGENTS.md context file
```

```ts
interface ResourceMapEntry {
  ref: string;
  mime: Mime;
  codec: string;
  title: string;
  /** 业务摘要：这是什么文档、服务于什么业务。 */
  summary: string;
  /** 文档骨架：Word 标题 / Excel 工作表 / PPT 幻灯片标题。 */
  outline?: string[];
  /** 关键业务事实：字段、指标、期间、实体、状态。 */
  keyFacts?: string[];
  /** 能力分组，不展开命令参数。 */
  capabilityGroups: string[];
}
```

资源地图回答的是业务问题：

- 工作区里有哪些文档、表格、演示文稿？
- 它们分别是什么类型、大致内容是什么？
- 哪些资源属于同一个项目 / 业务域？
- 这份资源能做什么类型的事情（编辑文本 / 表格 / 幻灯片 / 导出）？

因此，资源地图必须有**文件内容描述**，不能只有 ref / MIME / 插件名。否则 Agent 只能看到一堆文件地址，无法判断业务：

| 类型       | 业务摘要应包含                            |
| ---------- | ----------------------------------------- |
| Word       | 标题、章节大纲、关键段落 / 表格、业务对象 |
| Excel      | 工作表名、列头、关键指标、期间、命名区域  |
| PowerPoint | 演示主题、幻灯片标题、章节结构、关键结论  |
| PDF        | 文档标题、目录、关键页摘要、元数据        |

摘要不是全文，也不是 schema：

```text
summary   → 文档讲什么业务
outline   → 结构骨架
keyFacts  → 关键字段 / 指标 / 实体
文本全文  → project(agent, { detail: 'full' }) 按需读取
```

它不回答“`office.slide.add` 的参数 schema 是什么”，那由 `describe(session)` 负责。

sidecar 的归属：

- sidecar 是 URA 管理的派生资源，不是 Agent 专属出口，也不是插件注册面。
- Agent 是当前主要消费者；设置诊断、搜索或其他 UI 也可以读同一份 sidecar。
- 生命周期归 URA：生成、版本、失效、清理都由 URA 负责。

| sidecar         | 作用域   | 内容                                                          | 消费者         |
| --------------- | -------- | ------------------------------------------------------------- | -------------- |
| `resource-map`  | 工作区级 | 业务地图：ref、类型、标题、业务摘要、结构、关键事实、能力分组 | Agent、诊断    |
| `resource-text` | 单资源级 | 文本或结构化摘要                                              | Agent、UI 辅助 |

目标语义：

- **来源**：URA 的资源索引与 codec 注册表，不依赖列表 provider。
- **形态**：Markdown sidecar，有版本，可被 URA 读取和比较。
- **内容**：资源 ref、MIME、codec、标题、业务摘要、结构大纲、关键事实、能力分组；不展开全文和几百个命令的完整参数，全文由 `project(agent, full)`、命令由 `describe(session)` 按需读取。
- **身份**：规范身份是 URA 的 sidecar 资源（例如 `workstudio://resource-map`）；`AGENTS.md` 只是 pi 兼容的物化缓存，不作为权威来源。
- **失效**：资源结构或内容变化后去抖重建；版本变化才重新注入 Agent 上下文。
- **消费**：harness 通过 URA 读取，不直接按工作区路径读文件。
- **Pi 对应物**：Pi 把这类文件称为 **context file（上下文文件）**，`AGENTS.md` 是约定文件名；resource-map sidecar 物化后作为 context file 进入模型上下文。

#### 业务摘要从哪里来

资源地图的 `summary` / `outline` / `keyFacts` 不是手写，也不是从文件名猜，而是由 codec 的 Agent 投影生成：

```text
open(ref)
  → ResourceSession
  → project(agent, { detail: 'summary' })
  → summary / outline / keyFacts
  → resource-map entry
```

生成规则：

- **codec 负责摘要语义**：Word 提取标题与段落，Excel 提取工作表 / 列头 / 指标，PPT 提取幻灯片标题与结论。
- **摘要与全文分离**：地图只存摘要；全文通过 `project(agent, { detail: 'full' })` 按需读取。
- **内容变化才重建**：execute / 外部变更 / 保存后失效；结构索引变化触发地图更新。
- **大工作区分层**：根地图放简短摘要；`catalog.describe(folder)` 展开更详细的业务描述。
- **操作目录不进入摘要**：能力只以 `capabilityGroups` 摘要出现，具体命令仍由 `describe(resource)` 提供。

#### 业务地图与操作目录是两层

| 层                | 回答的问题                               | 形态                    | 加载方式                 |
| ----------------- | ---------------------------------------- | ----------------------- | ------------------------ |
| resource-map      | 有什么资源、是什么业务、能做什么类别的事 | 工作区级 Markdown       | 常驻 context             |
| resource-text     | 这份文档具体写了什么                     | 单资源 Markdown         | 打开 / 按需              |
| operation catalog | 具体命令怎么调用、参数是什么             | `OperationDescriptor[]` | `describe(session)` 按需 |

操作很多不会让 resource-map 膨胀，但也不会让 resource-map 变得可选。没有地图，Agent 连“该打开哪个 ref”都不知道，`describe/execute` 无从谈起。

#### 按需加载：catalog 逐层展开

资源地图是 catalog 的根摘要；真正的按需加载通过 scope describe 完成：

```text
resource-map（常驻，小）
  → catalog.describe(workspace)  → 业务域 / 目录 / 资源摘要
  → catalog.describe(folder)     → 该目录下的资源
  → catalog.describe(resource)   → 业务摘要 + 能力分组
  → searchResources(query)       → 摘要里没有的资源 / 内容
  → open(ref)                    → ResourceSession
  → describe(session)            → OperationDescriptor[]
  → execute(session, op, input)  → 执行业务动作
```

```ts
interface CatalogNode {
  ref: string;
  kind: 'workspace' | 'folder' | 'type' | 'resource';
  title: string;
  summary?: string;
  mime?: Mime;
  codec?: string;
  capabilityGroups?: string[];
  childCount?: number;
}

interface CatalogDescriptor extends CatalogNode {
  children?: CatalogNode[];
}

interface ResourceCatalog {
  describe(scope: string): Promise<CatalogDescriptor>;
  search(query: string): Promise<CatalogNode[]>;
}
```

规则：

- **root 很小**：resource-map 只给工作区概览和 catalog 入口，不塞全量树。
- **scope 逐层**：workspace / folder / type / resource 各自 describe，不一次展开全部。
- **catalog 只到能力分组**：`catalog.describe(resource)` 只返回业务摘要与 `capabilityGroups`；完整 `OperationDescriptor[]` 在 `open` 后的 `describe(session)` 返回。
- **execute 只做动作**：catalog 查询是 describe，不是 execute；execute 只作用于具体资源操作。
- **静态与动态分离**：操作目录来自 codec 注册表；资源摘要来自资源索引 / project(agent)；两者的缓存和失效互不绑定。

#### 三级缓存与操作边界

资源地图仍然存在，并且仍然是 sidecar；catalog 只是它的读取接口。资源本身按三级缓存组织：

| 层                   | 内容                                                       | 何时加载                       | 能否 execute |
| -------------------- | ---------------------------------------------------------- | ------------------------------ | ------------ |
| L1：workspace map    | 工作区概览、业务域、资源入口摘要                           | 常驻 context                   | 否           |
| L2：scope map        | 目录 / 类型 / 资源摘要、能力分组                           | `catalog.describe(scope)` 按需 | 否           |
| L3：resource session | 文档模型、全文投影、完整 OperationDescriptor[]、dirty 状态 | `open(ref)` 按需               | 是           |

```text
L1 workspace map
  ↓ catalog.describe(folder / type)
L2 scope map
  ↓ catalog.describe(resource) + open(ref)
L3 ResourceSession
  ↓ describe(session) / project(agent, full)
  ↓ execute(session, operation)
```

边界：

- **catalog 只读**：L1 / L2 负责发现、导航、业务摘要，不执行业务操作。
- **execute 只发生在 L3**：必须先 `open(ref)` 得到 ResourceSession，才能执行操作。
- **operation catalog 在 L3 完整化**：L2 只给能力分组；具体命令与 schema 在资源详情层返回。
- **resource-map 是 L1 / L2 的物化 sidecar**：catalog 是接口，不是替代 sidecar 的另一套存储。
- **失效分层**：资源索引变化失效 L1 / L2；内容变化或 execute 失效 L3，并去抖重建相关摘要。
- **codec 注册表独立**：插件安装 / 更新影响能力描述，不要求重开所有文档；按 codec 指纹更新 operation catalog。

所以答案不是“资源地图变成 describe/execute 的根，所以 sidecar 不要了”，而是：

```text
resource-map sidecar = L1 / L2 缓存
catalog.describe     = 读取 L1 / L2 的根接口
open + execute       = L3 才操作资源本身
```

#### 搜索层：弥补 L1 关键语义不足

只靠 L1/L2 的摘要 + describe/execute 是**封闭世界**：目录里没写到的语义，Agent 就找不到。Pi 的文本模式用 `find` / `grep` 解决了这个问题，办公资源也需要等价能力。

因此 URA 除了 catalog / sidecar，还需要一个搜索面：

```text
L1 workspace map        → 方向感：有哪些业务域、资源入口
search index            → 回忆：按关键词找到没出现在地图摘要里的资源
catalog.describe(scope) → 展开：目录 / 类型 / 资源摘要
open + describe         → 详情：文档模型 + 完整操作
execute                 → 动作
```

```ts
interface SearchHit {
  ref: string;
  title: string;
  mime: Mime;
  codec: string;
  snippet: string;
  score: number;
  capabilityGroups?: string[];
}

interface SearchRuntime {
  /** 资源搜索：名称、摘要、全文、结构化字段。 */
  searchResources(
    query: string,
    options?: { scope?: string; limit?: number },
  ): Promise<SearchHit[]>;

  /** 操作搜索：命令名、别名、描述、示例。 */
  searchOperations(
    query: string,
    options?: { ref?: string; type?: Mime; limit?: number },
  ): Promise<OperationDescriptor[]>;
}
```

搜索索引分层：

| 索引               | 内容                                  | 来源                      |
| ------------------ | ------------------------------------- | ------------------------- |
| metadata / summary | 标题、摘要、outline、keyFacts、能力组 | L1 / L2                   |
| content            | 段落、表格单元格、幻灯片文本          | `project(agent)` 的 chunk |
| operation          | 命令名、命名空间、描述、示例、别名    | codec 注册表              |

`find` / `grep` 不再只是文本工具，而是搜索面的适配器：

- `find` → 名称 / 路径 / 类型搜索
- `grep` → 全文 / 结构化字段搜索
- `searchOperations` → 命令发现
- `catalog.search` → 语义 / 别名搜索

渐进式加载因此变成：

```text
query
  → searchResources / searchOperations
  → hit.ref
  → open(ref)
  → describe(session)
  → execute(session, op)
```

L1 地图不需要包含所有 L3 语义；它负责方向感，搜索负责召回。两者缺一不可。

lark-cli 也受同一个问题影响：它的命令发现依赖 `--help`、`schema`、skills 和命令命名。它用 Shortcuts、Skills、affordance 文档缓解，但本质上仍是“命名 + 文档 + 搜索”的组合，不是 describe/execute 自动理解业务。

#### 操作很多时，sidecar 怎么同步

不要为每个 tool / 命令建 sidecar。sidecar 是**资源索引**，不是工具清单：

| 内容                             | 是否进入 resource-map | 如何获得                   |
| -------------------------------- | --------------------- | -------------------------- |
| 资源 ref、MIME、codec            | 是                    | 资源索引                   |
| schema 摘要                      | 是                    | codec 描述                 |
| 操作命名空间 / 命令数量          | 是，摘要级            | codec 注册表               |
| 每个命令的完整参数 schema        | 否                    | `describe(session)` 按需   |
| 每个 tool 的说明、示例、注意事项 | 否                    | 技能 / affordance 文档按需 |

同步机制：

- **单一事实源**：`OperationDescriptor` 由 codec 注册表提供，sidecar 只生成摘要，不手写、不复制 schema。
- **版本指纹**：sidecar 重建条件 = 工作区资源索引版本 + codec 注册表指纹；插件安装 / 卸载 / 更新、资源结构变化才失效。
- **去抖 + 内容哈希**：同一批变更合并重建；内容没变不写文件、不推进版本。
- **按需读取**：Agent 先看资源地图，决定要看某个资源时先 `open`，再 `describe(session)` 拿完整操作列表与参数；地图负责导航，describe 负责调用细节。
- **不按工具数量膨胀**：sidecar 大小随资源数量增长，不随 Office 命令数量线性增长。
- **工具说明外置**：命令的 when / 示例 / 风险放技能与 affordance 文档，不塞进 AGENTS.md。

这与 lark-cli 的分层一致：`AGENTS.md` 类似领域目录，`describe` 类似 `schema`，命令细节按需读取，而不是把所有命令文档同步进上下文。

### 4.9 UI 与 Agent 的共同路径

```text
UI：点击文件 / 插件前端打开页面
  → workStudio bridge（页面会话）
  → resources domain
  → URA.open(ref)
  → transport 插件 load
  → codec 插件 decode
  → project(ui)
  → PageSpec
  → 应用查看器或插件前端
  → 用户编辑
  → workStudio bridge（save）
  → URA.execute(session, 'edit', ...)
  → codec 插件 encode
  → transport 插件 commit
  → 来源

Agent UI：assistant / 会话
  → sessions domain
  → Agent harness（第二层）
  → read 工具
  → URA.open(ref)
  → transport 插件 load
  → codec 插件 decode
  → project(agent)
  → Markdown / 结构化结果
  → 模型决策
  → URA.execute(session, 'edit', ...)
  → codec 插件 encode
  → transport 插件 commit
  → 来源
```

两条路径共享：codec 解析、decode、写队列、冲突检测、错误语义、审计。两条路径不共享：投影形态、交互节奏、会话生命周期。

## 五、现状与目标差距

| 主题             | 已实现                                                                | 目标                                            | 差距 / 动作                                               |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Renderer 页面    | 传统 UI 与 Agent UI 混在“消费者”一层                                  | 传统 UI 页面 / Agent UI 页面分开                | 明确页面归属；插件前端归传统 UI                           |
| Agent 分层       | Agent UI 与 harness 未分层表达                                        | Agent UI 在 renderer；harness 为第二层          | 分开 UI 与执行层；传统 UI 不经过 harness                  |
| 插件分类         | codec、transport、presenter、sidecar、list、view action 在一个 SDK 中 | codec（上）/ transport（下）/ 前端分别有契约    | 拆分 SDK；保持 codec 在上、transport 在下的分层           |
| 资源类型         | `RawContent` 的 MIME 可选，codec 键带 transport                       | `mime + bytes`，MIME 必填                       | transport 提供 MIME；codec 解释格式                       |
| codec 键         | `(transport, mime)`                                                   | 只按 MIME / 扩展名                              | 移除 codec 对 transport 的依赖；绑定改为 format           |
| codec 注册面     | codec + store + presenter + sidecar + list + view action              | codec 原语 + core 特化 + codec commands + view  | 移除 presenter/sidecar/list/view action                   |
| transport 注册面 | 与 codec 共享 SDK；内置来源在 URA 运行时注册                          | 独立 transport SDK，位于 codec 下层             | 分离注册 API；read/write 改为 load/commit                 |
| 插件前端         | page/settings 通过 `window.extension` 使用页面会话                    | 前端只经 bridge 到 URA；PageSpec + 受限页面契约 | 固定页面会话命令与总线类型；禁止任意 domain 调用          |
| 页面归属         | presenter 同时决定 surface、页面与数据                                | 清单声明页面入口；codec 只给 view 数据          | 拆分页面解析与数据投影；surface 映射移到视图宿主          |
| Agent 读法       | sidecar 被当作 Agent 专属出口，由插件后端注册                         | sidecar 归 URA；Agent 只是消费者                | 移除插件 sidecar 注册；资源地图独立为 URA sidecar         |
| 操作模型         | 固定 7 个工具 + Office 3 个工具；命令散落在工具层                     | 核心操作 + codec 类型命令；统一 `execute`       | 增加 OperationDescriptor / describe / execute             |
| Agent 工具       | 每个命令一个工具，命令多时工具爆炸；文本工具被当成通用操作            | 文本工具是适配器；类型命令走 `resource.exec`    | 按 `describe` 能力暴露；write/edit 只对可写文本开放       |
| URA 定位         | 注册表分发 + 门面；按 caller 选 presenter/sidecar                     | 统一入口 + Sidecar；MIME 分发在 codec 层        | 引入 ResourceSession / project / execute；拆出 codec 分发 |
| 写路径           | 页面保存做基线校验；工具写入直接走门面                                | 所有写操作共享队列与冲突处理                    | 页面保存与 Agent 写入收敛到操作内核                       |
| 列表             | 插件后端 `registerList`                                               | UI 投影；前端/应用声明                          | 从后端注册面移出；地图不再依赖列表                        |
| 资源地图来源     | 列表 provider                                                         | URA 资源索引 + codec 描述                       | 去掉对列表的依赖；地图内容改为类型/能力视图               |
| 资源地图形态     | 工作区 `AGENTS.md` 文件；harness 直接读                               | URA sidecar；Markdown 缓存；可物化              | 注册 sidecar；规范身份与版本；harness 改走 URA            |
| 类型描述         | codec id + extension；无显式能力                                      | codec id、MIME、schema、operations              | 新增 codec 描述；UI 工具条、Agent 工具、地图共用          |
| 装配             | URA 运行时创建插件宿主；插件 SDK 可注册列表与 transport               | URA 依赖 codec；transport 在其下层；组合根装配  | 把插件宿主移出 URA 运行时；系统来源由组合根装配           |
| 验收             | 以页面/工具各自行为为主                                               | UI/Agent 行为一致性 + SDK 边界 + bridge 约束    | 增加双路径、codec/transport 分离、越权 bridge 用例        |

## 六、需要坚守的规则

- **codec 插件只认识格式**：不出现 transport、UI、Agent、页面、列表、surface 概念。
- **transport 插件只认识字节**：只做 stat / load / commit / list / watch，不出现文档级 read/write、decode、encode、页面或 Agent 概念。
- **文档操作在 codec，字节操作在 transport**：read / write / edit / query 属于 codec；stat / load / commit / list / watch 属于 transport。
- **两类后端插件不共用 API**：codec SDK 与 transport SDK 分开；一个包可以同时贡献两类，但注册入口分开。
- **分层与 SDK 分离**：codec 在 transport 之上是抽象层级；不代表 codec 直接依赖 transport，字节由 URA 编排。
- **Agent UI 与 harness 分层**：Agent UI 是 renderer 页面，harness 是主进程第二层；传统 UI 不经过 harness。
- **插件前端只认识页面会话**：只经 bridge 到 URA，不直接调用 codec 插件，不拿裸 IPC，不越过页面权限。
- **页面是前端资产，不是 codec 注册项**：清单声明入口，前端消费 PageSpec。
- **URA 是唯一资源入口**：应用 UI、插件前端和 Agent 不直接调用后端插件，也不直接读写来源。
- **MIME 分发归 codec 层**：入向 decode 与出向 encode 都由 codec 层选择实现，URA 只调用统一接口。
- **URA 的重点**：为传统 UI 与 Agent Harness 提供统一入口，并维护 Sidecar；不把 MIME 分发和 codec 注册表塞进入口层。
- **投影不是后端**：UI 与 Agent 的差异只在投影，不在解析、操作和写路径。
- **sidecar 归 URA**：sidecar 是派生资源，不是 Agent 专属出口；Agent 只是消费者。
- **地图是派生缓存**：可以删除重建；不是工作区事实源，不参与资源写入冲突。
- **类型能力可声明**：没有声明的操作不出现；UI 与 Agent 从同一份能力表读取。
- **列表是 UI 投影**：列表不提供资源地图，也不决定资源是否存在。
- **单一写队列**：同一 ref 的 UI 保存与 Agent 编辑共享串行化和冲突处理；本版不引入资源版本。
- **一个执行入口**：核心操作与 codec 命令都走 `execute` + `OperationDescriptor`；不为每个命令增加 URA 方法。
- **命令命名空间**：核心操作名保留；Office 等类型命令必须带命名空间，避免冲突。
- **工具不爆炸**：Agent 保留核心工具，类型命令通过通用 `resource.exec` 按需执行。
- **按需加载靠 catalog**：root map 常驻，workspace / folder / type / resource 逐层 describe，只对具体资源加载操作。
- **无 Capability 层**：融合发生在 URA，不新增一层生命周期/能力对象。

## 七、收敛顺序

1. **固定四份契约**：`CodecPlugin`、`TransportPlugin`、`PageSpec / 页面会话`、`resource-map sidecar`。
2. **拆分 SDK**：codec SDK 只注册 codec；transport SDK 只注册来源；保持 codec 在上、transport 在下的分层；前端页面清单化。
3. **去掉 codec 的 transport 键**：按 MIME / 扩展名匹配；绑定与诊断同步调整。
4. **拆分插件注册面**：移除 codec 的 presenter、sidecar、list、view action。
5. **引入资源会话与操作注册**：`open` 产出 session；`describe` 暴露核心操作与类型命令；`execute` 统一分发。
6. **收敛写路径**：页面保存与 Agent 写入共用操作内核的队列和冲突处理；版本不在本版范围。
7. **重建资源地图**：从资源索引生成 sidecar，移除列表依赖；harness 改为通过 URA 读取。
8. **清理装配**：URA 运行时不再创建插件宿主；组合根负责 codec 注册表、transport 下层、插件宿主与 URA 的装配。
9. **补齐验收**：同一资源的 UI/Agent 读取、编辑、查询、冲突、地图更新、SDK 边界与 bridge 越权必须可对照验证。

## 八、待确认

- codec 的 MIME 匹配是否需要额外的内容探测，还是只依赖 transport 给出的 MIME + 扩展名？
- MIME 绑定是否允许按扩展名覆盖；冲突时按注册顺序还是显式优先级？
- transport 插件是否允许同时带前端设置页；还是设置面只属于 codec / 应用？
- codec 插件的 `view` 返回结构化数据，还是只提供资源 ref，由前端通过页面会话自行取数？
- 资源地图的规范身份采用虚拟 sidecar ref，还是继续使用工作区 `AGENTS.md` 作为唯一身份？
- UI、插件前端与 Agent 是否共享完全相同的权限；还是 Agent 需要额外的资源访问授权与审计？
