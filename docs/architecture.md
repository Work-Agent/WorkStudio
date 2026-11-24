# 架构设计

> WorkStudio 是以文件为中心的桌面工作台。主进程持有状态与运行时，渲染层只消费投影并发送意图；会话交给 pi，资源由 URA 统一解释。

> 目标架构与当前实现的差距见 [目标架构与现状差距](./architecture-target.md)；本文描述已实现架构。

## 一、总体设计

### 1.1 分层

主进程按职责分为三层：

| 层          | 职责                                                              | 不负责             |
| ----------- | ----------------------------------------------------------------- | ------------------ |
| Runtime     | DomainRegistry · Dispatcher · 存储 / 日志 / 网络适配              | 业务状态           |
| Domains     | 业务状态、resource、command、订阅与推送，以及各自的内部实现       | 框架分发机制       |
| Agent Layer | pi runtime、harness、tools、会话持久化；由 AgentDomain 持有与暴露 | 传统 UI 的资源装配 |

Domain 按能力拆分为 `workspaces` / `resources` / `lists` / `plugins` / `shell` / `settings`，以及 agent 下的 `sessions` / `models` / `skills` / `thinking` / `extensions` / `tools` / `prompts` / `themes`；生命周期按依赖合并为四个 DomainModule：`workspace` 组合工作区、资源 / URA、列表与插件，`shell` 组合窗口、视图、布局、主题、对话框与通知，`settings` 组合设置、偏好、外观与更新，`agent` 是 Agent Layer 的 IPC / 资源边界。

App 是组合根，只负责创建 Runtime、装配四个 Domain / provider / IPC、管理窗口与进程生命周期。

没有 Capability 类、controller、Port 接口或独立生命周期接口。DomainModule 声明 `dependencies`，DomainRegistry 按拓扑序 start、反向 stop。

### 1.2 总体图

```text
┌─ Renderer ───────────────────────────────────────────────────────┐
│ shell · assistant · overlay · settings · welcome（多页面入口）    │
│ 页面只订阅自己消费的 resource，不持有权威状态                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ window.workStudio
                               │ subscribe / command / notify / onUpdate
┌─ Runtime ────────────────────▼───────────────────────────────────┐
│ DomainRegistry · Dispatcher                                      │
│ storage · log · net · policy                                     │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Domains ────────────────────▼───────────────────────────────────┐
│ workspaces · resources · lists · plugins                         │
│ shell · settings                                                │
│ agent：sessions · models · skills · thinking · extensions · tools · prompts · themes          │
│ 生命周期模块：workspace / shell / settings / agent               │
└──────────────────────────────┬───────────────────────────────────┘
┌─ Agent Layer ────────────────▼───────────────────────────────────┐
│ pi runtime · harness · tools · sessions · skills                 │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 官方扩展点
                            pi SDK / URA
```

### 1.3 关键决策

| 决策       | 选择                               | 理由                                                              |
| ---------- | ---------------------------------- | ----------------------------------------------------------------- |
| 组织单位   | Domain / Resource                  | 按依赖合并 DomainModule，订阅 / 命令 / 推送以 resource 为最小单位 |
| 运行时装配 | DomainModule.dependencies + 拓扑序 | 依赖关系显式，不引入 DI / service locator                         |
| 状态归属   | 主进程唯一真相源                   | 渲染层只持投影，避免人机两套状态                                  |
| 列表       | provider → snapshot                | 内置列表与插件列表共用同一条流程                                  |
| 通讯       | `window.workStudio`                | 页面不暴露裸 IPC，不依赖 Electron / Node                          |
| 内容页     | `window.extension` + 受限资源命令  | 资源页 / 插件页没有 Node，也不直接访问 domain                     |
| 视图       | 两层视图 + provider                | 系统视图与内容标签分开，新增内容形态不改视图能力                  |
| 布局       | 主进程计算，scene 持久化           | DOM 与原生视图消费同一份几何，拖拽不反复重排                      |
| IPC 日志   | Dispatcher 直接记录                | 不引入 middleware，不记录 input                                   |

## 二、状态与生命周期

### 2.1 状态归属

| 状态                      | 生命周期 | 真相源                                  | 持久化                         |
| ------------------------- | -------- | --------------------------------------- | ------------------------------ |
| 窗口 / 主题 / scene       | 进程     | WindowManager / ThemeManager / Scene    | `scene.json`（按工作区）       |
| 工作区注册表              | 进程     | WorkspacesRepo                          | 工作区注册文件                 |
| 模型 / 凭证 / 全局设定    | 进程     | AgentHost / ModelConfigStore / 设置存储 | 数据根下的模型、凭证与设置文件 |
| 资源 / 列表 / 会话 / 站点 | 工作区   | Resources / Lists / Sessions / URA      | 工作区目录与 `sessions/`       |
| 当前回复与任务            | 会话     | SessionsService                         | 由 pi 写入会话 JSONL           |
| 设置页 / 更新 / 插件任务  | 应用     | settings / plugins domain               | 由各自运行时持有               |

### 2.2 作用域

- **App**：模型目录、凭证、插件安装、全局设置、工作区列表、当前工作区、系统视图。
- **Workspace**：资源、列表、标签视图、scene、页面会话、会话索引、浏览器策略、项目设置。
- **Session**：pi runtime、消息、轮次、队列、上下文与技能激活。

工作区切换 = 释放旧 resources / sessions / plugins 关联 + 重绑新工作区；会话切换 = pi 切换 + 事件重新绑定。

### 2.3 存储布局

```text
<data-root>/
├── settings.json                 # 用户级设置（pi 原生字段 + workspaceStudio 命名空间）
├── models.json                   # 自定义供应商与模型
├── auth.json                     # 供应商凭证
├── workspaces/<wsId>/
│   ├── workspace.json            # 工作区自描述
│   ├── scene.json                # 布局与 UI 现场
│   ├── settings.json             # 工作区设置 / 策略
│   ├── sessions/                 # 会话 JSONL
│   └── sites/<domain>/           # 浏览器快照
├── plugins/                      # 已安装文档插件
└── skills/                       # 内置技能落盘
```

- `workspaceStudio` 只替换自己的命名空间，pi 字段与未知字段原样保留。
- 不读写 `~/.pi` 或真实工作区的 `.pi`。
- 页面会话、写队列、脏标记归框架；来源内容仍以来源为准。

## 三、Runtime

### 3.1 Domain 与 Resource

```ts
interface Domain {
  resource(name: string): Resource;
}

interface Resource {
  snapshot(provider: () => unknown): void;
  command<I, O>(
    action: string,
    handler: (call: Call<I>) => O | Promise<O>,
  ): void;
  notify(action: string, handler: (call: Call<unknown>) => void): void;
  publish(): void;
  patch(value: Record<string, unknown>): void;
  event(value: unknown): void;
}
```

- `snapshot` 建立可序列化的当前值。
- `command` 是有回复操作，统一返回 `{ ok, data }` 或 `{ ok:false, error }`。
- `notify` 是无回复操作。
- `publish` 推完整快照；`patch` 推增量；`event` 推一次性事件。
- Domain 只暴露状态与命令，不暴露内部运行时对象。

### 3.2 DomainRegistry / Dispatcher

- **Dispatcher**：sender → origin → DomainRegistry；识别 shell / 系统视图 / 内容视图来源，并直接记录 IPC 请求日志。
- **DomainRegistry**：domain 注册、命令路由与 update 分发。
- **日志开关**：`AppOptions.ipcLog` 或 `WA_IPC_LOG=1`；只记录地址、来源、耗时与结果。
- 订阅只对 `(domain, resource)` 建立；更新只发给订阅该 resource 的 view。
- 不存在的 domain / resource / action 返回明确错误，不静默降级。

### 3.3 Views / Providers / Native

- **GlobalViews**：窗口级系统视图（shell / assistant / overlay / capture），不进入标签集合。
- **Tabs**：内容视图（page / web）；管理顺序、激活、固定、脏态、冲突与释放。
- **Views**：跨窗口查找、tabs domain、provider 调用与内容视图打开。
- **Providers**：声明 `resource / settings / plugin / web / welcome` target 如何解析成页面规格。
- **Native**：BrowserWindow、WebContentsView、窗口几何、主题、菜单、系统动作。

视图形状：

```text
WorkspaceWindow
├─ GlobalViews：shell / assistant / overlay / capture
└─ Tabs：page / web
```

### 3.4 Layout / Scene / Interaction

- Layout 由主进程根据窗口尺寸与 scene 计算；DOM 只消费矩形和 CSS 变量。
- Scene 是唯一持久现场：栏宽、侧栏折叠、助手形态、面板状态。
- 拖拽开始冻结起点；move 只更新 preview；end 收敛为 scene patch；cancel 丢弃 preview。
- 交互期间 capture 视图接管指针；结束或失焦必须清理。
- 不单独设 interaction controller；交互是 layout 的临时状态。

## 四、Domains

| Domain / Resource                           | State                                | Commands                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces/list`                           | 工作区列表                           | `open` / `close` / `rename` / `remove` / `refresh`                                                                                                                                                    |
| `workspaces/current`                        | 当前工作区                           | —                                                                                                                                                                                                     |
| `resources/current` · `resources/ws:<wsId>` | workspaceId / ready / pages          | `read` / `write` / `edit` / `ls` / `find` / `grep` / `query` / `tree` / `watch` / `openPage` / `savePage` / `reloadPage` / `closePage` / `open` / `openWeb` / `openPageView` / `saveCopy` / `refresh` |
| `lists/current` · `lists/ws:<wsId>`         | 侧栏快照                             | `refresh` / `action`                                                                                                                                                                                  |
| `plugins/list`                              | 运行时插件                           | `open` / `getSetting` / `setSetting` / `install` / `remove` / `reload` / `catalog`                                                                                                                    |
| `plugins/installed`                         | 已安装来源                           | —                                                                                                                                                                                                     |
| `plugins/catalog`                           | 插件目录来源                         | —                                                                                                                                                                                                     |
| `plugins/task`                              | 安装任务                             | `cancel` / `retry`                                                                                                                                                                                    |
| `settings/pages`                            | 设置卡片清单                         | `open`                                                                                                                                                                                                |
| `settings/appearance`                       | theme / zoom / effectiveTheme        | `set`                                                                                                                                                                                                 |
| `settings/storage`                          | 数据根 / 工作区 / 路径 / 版本        | `open` / `changeRoot` / `changeSessionDir`                                                                                                                                                            |
| `settings/browser`                          | allowlist                            | `set`                                                                                                                                                                                                 |
| `settings/preferences`                      | theme / locale / proxy / githubToken | `set`                                                                                                                                                                                                 |
| `settings/advanced`                         | piconf / bindings                    | get / set / replace / setBinding / removeBinding                                                                                                                                                      |
| `settings/extensions`                       | 扩展清单                             | catalog / install / remove                                                                                                                                                                            |
| `settings/resourceInfo`                     | URA 来源 / 格式 / 表现层诊断         | —                                                                                                                                                                                                     |
| `settings/updates`                          | 更新状态                             | `check` / `download` / `cancel` / `open`                                                                                                                                                              |
| `sessions/current`                          | 当前会话                             | new / open / prompt / steer / followUp / abort / compact / retry / fork / rename / delete / setModel / refresh                                                                                        |
| `sessions/list` / `opened` / `active`       | 会话投影                             | —                                                                                                                                                                                                     |
| `sessions/task` / `commands`                | 任务与命令投影                       | `opened.close`                                                                                                                                                                                        |
| `models/available`                          | 可用模型目录                         | —                                                                                                                                                                                                     |
| `models/config`                             | providers / catalog / config         | login / logout / save / delete                                                                                                                                                                        |
| `skills/active`                             | 当前激活技能                         | `setActive`                                                                                                                                                                                           |
| `skills/catalog`                            | 技能清单 / 诊断                      | reload / setEnabled / diagnostics / openPlugin                                                                                                                                                        |
| `thinking/current`                          | level / levels                       | `set`                                                                                                                                                                                                 |
| `extensions/list` / `errors`                | 已加载扩展 / 装载错误                | `reload`                                                                                                                                                                                              |
| `tools/list`                                | 扩展注册工具                         | —                                                                                                                                                                                                     |
| `prompts/list`                              | 提示词模板                           | —                                                                                                                                                                                                     |
| `themes/list`                               | 主题资源                             | —                                                                                                                                                                                                     |
| `shell/theme`                               | light / dark / system + effective    | `set`                                                                                                                                                                                                 |
| `shell/windows`                             | 窗口集合                             | `focus` / `close` / `open` / `beginMove` / `updateMove` / `endMove`                                                                                                                                   |
| `shell/tabs:<wsId>`                         | 窗口标签集合                         | activate / close / togglePin / move / closeOthers / closeToLeft / closeToRight / closeAll / goBack / goForward / navigate / action                                                                    |
| `shell/scene:<wsId>`                        | 窗口现场                             | `patch`                                                                                                                                                                                               |
| `shell/layout:<wsId>`                       | 布局快照                             | `begin` / `move` / `end` / `cancel`                                                                                                                                                                   |
| `shell/dialogs`                             | 对话框                               | `open` / `ask` / `respond`                                                                                                                                                                            |
| `shell/notices`                             | 通知                                 | `notify` / `dismiss`                                                                                                                                                                                  |
| `shell/native`                              | —                                    | openPath / openExternal / pickDirectory / pickSaveFile / popupMenu                                                                                                                                    |

## 五、Domain 内部实现与 Runtime 适配

### 5.1 DomainModule 与依赖

| DomainModule | 依赖                          | 拥有                                                                                                              |
| ------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `shell`      | —                             | WindowManager、Views、Scene、Theme、Layout、Dialogs、Notices                                                      |
| `workspace`  | `shell`                       | WorkspacesRepo、URA、ResourcesService、Lists、Plugins、Sites（domain 仍拆分）                                     |
| `agent`      | `shell`、`workspace`          | AgentHost、SessionsService；domain：sessions / models / skills / thinking / extensions / tools / prompts / themes |
| `settings`   | `shell`、`workspace`、`agent` | 设置资源、偏好、外观、扩展、更新                                                                                  |

- `workspace` 是生命周期模块 id，不是 domain；其内部 domain 为 `workspaces` / `resources` / `lists` / `plugins`。
- `DomainModule` 只声明 `id`、`dependencies`、`attach` 与可选 `start` / `stop`。
- `DomainRegistry` 按依赖拓扑序 start，按反向序 stop；缺依赖或出现环直接报错。
- 不引入 DI 容器、DomainGateway 或 service locator；跨 Domain 依赖由组合根或显式 getter 连接。

### 5.2 Workspace module 内部

| 实现        | 职责                                                                |
| ----------- | ------------------------------------------------------------------- |
| `ura`       | transport / codec / store / presenter / sidecar、资源地图、页面会话 |
| `resources` | 资源读写 / 检索 / 页面会话编排                                      |
| `lists`     | 列表定义、provider、snapshot 构建                                   |
| `plugins`   | 插件安装、catalog、PluginHost、插件注册面                           |
| `browser`   | 浏览器能力注册、站点集合、a11y 动作                                 |
| `sites`     | 站点快照与白名单过滤                                                |
| `repo`      | 工作区注册仓储                                                      |

### 5.3 Shell 内部

| 实现             | 职责                                              |
| ---------------- | ------------------------------------------------- |
| `native`         | WindowManager、ThemeManager、Scene、SystemActions |
| `views`          | GlobalViews / Tabs、视图记录与发送                |
| `view-providers` | 打开契约 → ViewSpec                               |
| `app-views`      | 助手 / 浮层 / 欢迎 / 资源页 / 插件页的打开入口    |
| `layout`         | 每窗口 scene / layout resource 与交互绑定         |
| `interaction`    | 布局计算与拖拽 preview                            |
| `dialogs`        | 对话框与通知                                      |
| `menu`           | 应用菜单                                          |
| `app-pages`      | `app://` 页面协议                                 |

### 5.4 Settings / Agent

- `settings` 内部持有更新服务；`settings/updates` 与设置资源共享生命周期。
- `agent`（AgentDomain）是 Agent Layer 的边界：AgentHost、SessionsService、模型、技能与 harness 都在 `src/main/agent`，对外拆成 `sessions` / `models` / `skills` / `thinking` / `extensions` / `tools` / `prompts` / `themes` 八个 domain。

### 5.5 Runtime 适配

| 实现      | 职责                                   |
| --------- | -------------------------------------- |
| `storage` | 数据根、StoragePaths、偏好、路径编解码 |
| `net`     | 代理与出站 HTTP 调度                   |
| `log`     | 诊断日志                               |
| `policy`  | WebContents 安全加固                   |

Runtime 不反向依赖 Domains；Domain 内部实现不直接改 Views 之外的原生状态。

## 六、跨进程契约

### 6.1 workStudio bridge

```ts
interface WorkStudioBridge {
  subscribe(domain: string, resource: string): Promise<unknown>;
  unsubscribe(domain: string, resource: string): void;
  command<T>(
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<CallResult<T>>;
  notify(
    domain: string,
    resource: string,
    action: string,
    value?: unknown,
  ): void;
  onUpdate(listener: (update: DomainUpdate) => void): () => void;
}
```

更新帧：

```ts
type DomainUpdate =
  | { type: 'snapshot'; domain: string; resource: string; data: unknown }
  | {
      type: 'patch';
      domain: string;
      resource: string;
      data: Record<string, unknown>;
    }
  | { type: 'event'; domain: string; resource: string; data: unknown };
```

- 订阅返回当前 snapshot，并建立后续 patch / event 推送。
- command 返回 `{ ok:true, data }` 或 `{ ok:false, error }`。
- notify 不等待回执。
- 渲染层不直接写状态，不持 Node，不访问 Electron 对象。

### 6.2 内容页

- shell / assistant / overlay / settings / welcome：`window.workStudio`。
- 资源页 / 插件页：`window.extension`，preload 内部调用 resources domain 与内容总线。
- 浏览器页：只暴露最小 `window.browser`。
- 内容投递在页面 ready 后执行；页面只拿页面 id、入口与数据。
- 保存、重读、脏态、动作状态通过受约束的视图总线回传。

## 七、视图与内容

### 7.1 View providers

| target     | 归属      | 解析                                                 |
| ---------- | --------- | ---------------------------------------------------- |
| `resource` | resources | URA 打开页面会话，生成 `app://page/...` 内容页       |
| `settings` | settings  | 单页设置入口，`contentPath=/settings/page/home`      |
| `plugin`   | plugins   | 插件清单中的 page / settings 出口                    |
| `web`      | browser   | 直接导航 URL，按 URL 复用标签                        |
| `welcome`  | app       | 内置欢迎页，`contentPath=/welcome`，每个窗口最多一个 |

### 7.2 标签语义

- 集合顺序即标签顺序；激活项唯一。
- 关闭当前标签后选择最后剩余标签；没有标签时自动恢复欢迎页。
- 新 tab 创建后立即补写当前内容区几何，不等待下一次 layout 发布。
- 固定、拖拽排序、脏点、冲突、缺失由 tabs 投影携带。
- 设置页 / 欢迎页 / 插件设置页按 contentPath 复用。

## 八、列表

列表统一为 provider 管道：

```text
ListRegistry
  ├─ docs / temp / sessions / plugins / settings provider
  └─ 插件注册 provider
        ↓
buildListSnapshot()
        ↓
lists/ws:<wsId>
```

- 定义、provider、snapshot 构建在 workspace module 内部；domain 只暴露快照与打开动作。
- `lists/current` 是当前工作区别名，供不持有 wsId 的页面使用。
- 每个 provider 返回分组；组内 item 携带标题、图标、字段、动作与 meta。
- 列表行状态（open / active / dirty）由当前视图集合回写。
- 单组失败只标记该组 error + diagnostics，其他组继续。
- 用户点击只发 `lists/ws:<wsId>.action { action: 'open', item }`；打开目标由 workspace module 路由到资源 / 设置 / 插件。

## 九、资源管道 URA

### 9.1 分段

```text
ref ─► transport ─► RawContent
    ─► (transport, mime) ─► codec ─► document
    ─► (transport, mime, codec) ─► presenter / store / sidecar
```

- ref 是来源身份；MIME 是格式身份；codec 是解释实现。
- 绑定表决定 codec / presenter；用户绑定覆盖默认值。
- 读失败或无解释器时降级 raw，并记录降级点。
- 写入沿同一张绑定表：定位 → 编码最小补丁 → 来源提交。
- 页面会话由 URA 持有；页面只拿 id、入口、数据与白名单命令。

### 9.2 浏览器旁路

- 在线网页不经过 transport / codec；视图宿主导航 WebContentsView。
- 白名单域的快照以 Markdown 落入工作区 sites；快照服务侧车与资源地图。
- 浏览器自动化通过受控 CDP / 注入能力提供，不向页面或插件暴露。
- 站点条目打开的是实时网页，不是快照文件。

## 十、Agent / 会话

- AgentHost 复用 pi runtime；WorkStudio 只做资源地图、技能筛选、工具与事件投影。
- 会话文件是 pi 的 JSONL；SessionsService 维护列表、消息、流式投影、任务状态与打开标签。
- 任务状态包含 running / stopping / stopped / failed / done / unconfirmed；停止要等待运行时确认。
- 失败重试重发原请求；可能有副作用时先要求确认。
- 技能启用状态归工作区；本轮选中集随 prompt 传入；未选中表示全部启用。
- 助手视图只消费 agent domain，不直接访问 AgentHost。

## 十一、渲染层

### 11.1 多页面结构

```text
pages/
  shell/       壳层：标题栏 · 侧栏 · 资源面板 · 欢迎 / 内容标签
  assistant/   会话标签 · 消息流 · 输入与工具条
  overlay/     对话框 / 通知
  settings/    单页设置卡片
  welcome/     工作区入口
shared/
  api/         workStudio / 路径展示
  domains/     跨页面 domain hook
  styles/      共享主题与基础样式
```

- 每个页面独立 HTML 入口，Vite 多页面构建。
- 页面模块自己订阅 resource、自己管理本地状态；不建立统一全局状态层。
- shell 专属 domain 留在 shell 页面；settings / welcome 只共享必要 domain。
- 主题使用 `prefers-color-scheme`，内容视图缩放通过 WebContentsView zoom factor 生效。

### 11.2 壳层

- 左栏资料树 / 列表；中央标签与原生内容；右栏助手；标题栏入口。
- DOM 只画壳层与空态；内容由原生视图承载。
- 地址栏展示逻辑地址或相对路径，不泄露本机绝对路径。

## 十二、设置与更新

- 设置是单页 domain 消费方：卡片默认收起，展开后直接使用 workStudio resource / command，无 iframe。
- 外观只有 light / dark / system；界面缩放使用百分比。
- 更新是 `settings/updates` resource；设置页只是消费者。
- 插件安装任务、技能诊断、模型供应商、URA 绑定、存储路径与资源诊断都有独立 resource / command。
- 设置写入不得覆盖未提交表单；路径展示以 `app/` / `workspace/` 等逻辑根呈现。

## 十三、约束、失败与验收

### 13.1 依赖与边界

- 渲染层不 import 主进程；只走 preload 暴露的 workStudio / extension。
- Domain 不持 Electron / Node 句柄；内部实现不绕过 Views 修改原生状态；Runtime 不反向依赖业务。
- 视图管理不碰格式、版本、写队列。
- 页面无 Node、无裸 IPC；浏览器页不暴露应用 bridge。

### 13.2 失败与降级

| 失败                     | 处理                                       |
| ------------------------ | ------------------------------------------ |
| 列表 provider 失败       | 该组 error + diagnostics；其他组继续       |
| URA 无 codec / presenter | 返回 raw + 明确降级信息                    |
| 写冲突                   | 保留草稿；保存前核对基线；冲突不覆盖原文件 |
| 视图崩溃                 | 只影响该视图；壳层与其他视图继续           |
| 插件装载失败             | 保留安装记录；可单独重载；不影响其他插件   |
| 页面未 ready             | 主进程排队投递；超时错误可见               |

### 13.3 不变量

- 单写者：业务状态只由对应 domain / runtime 修改。
- 单资源：订阅、命令、推送都以 `(domain, resource)` 为单位。
- 状态全量：snapshot 是当前完整值；patch 只作用于已订阅资源。
- 释放完备：工作区切换关闭内容视图、页面会话、监听器与任务。
- 列表自包含：ListSnapshot 带渲染所需 spec。
- 地址不泄露：运行期不展示完整本机路径。
- 安装即信任：不执行项目目录未安装代码。

### 13.4 验收

- **通讯**：订阅返回 snapshot；command 有回执；notify 无回执；页面无裸 IPC。
- **工作区**：切换后旧视图、页面会话、列表、Agent cwd 与 project 设置全部同步；失败不留下半切换状态。
- **视图**：关闭当前标签后有有效激活项；无标签时欢迎页恢复；新标签有有效几何；地址栏不出现绝对路径。
- **列表**：provider 注册即出现；单组失败不影响其他组；打开 / 激活 / 脏态与视图集合一致。
- **资源**：人 / 页面 / Agent 都经 URA；写冲突保留草稿；浏览器页不暴露应用 bridge。
- **设置**：所有卡片有真实行为；主题只有 light / dark / system；缩放只作用内容视图；未提交表单不被后台刷新覆盖。
- **Agent**：流式、停止、重试、fork、技能选择沿真实事件收敛；停止后草稿保留；成果不自动声明已验收。
- **E2E**：共享 case 同时通过 CDP dev 与 Playwright 隔离运行；破坏性 / 重启类用例只在 Playwright 跑。
