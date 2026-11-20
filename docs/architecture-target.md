# 目标架构：能力图与统一执行闸门

> 本文描述 WorkStudio 的目标架构，并对照当前实现。目标架构取消 URA 作为独立层：资源发现、读取与操作收进 Business Domain；DomainRegistry 是唯一的能力图与执行闸门，传统页面与 Agent 都是它的投影。当前稳定实现见 [架构设计](./architecture.md)。

## 一、已实现架构

### 1.1 当前总体结构

```text
┌─ Renderer：多页面 ──────────────────────────────────────────────┐
│ shell / assistant / overlay / settings / welcome                │
│ 插件前端：markdown / html / text（window.extension）            │
└──────────────┬─────────────────────────────────┬────────────────┘
               │ preload workStudio              │ extension page session
               ▼                                 ▼
┌─ App / IPC ─────────────────────────────────────────────────────┐
│ IPCDispatcher → DomainRegistry                                  │
│ domains：workspaces / resources / lists / plugins                │
│          shell / settings / sessions / models / skills           │
│          thinking / extensions / tools / prompts / themes        │
└──────────────┬─────────────────────────────────┬────────────────┘
               │                                 │
     Resources domain                     Sessions domain
       → ResourcesService                   → AgentHost / SessionsService
       → URA runtime                        → Harness（URA tools / office_gen）
         ├─ UraRegistry
         │   ├─ transport / codec / store
         │   ├─ presenter / sidecar
         │   └─ view action
         ├─ ResourcePipeline / Ura facade
         ├─ PageSessions
         ├─ PluginHost（builtin + installed）
         ├─ BindingStore
         └─ ResourceMap ← ListRegistry → AGENTS.md

Views / WindowManager / Native / Layout
  → shell 窗口 + assistant / overlay / capture + tabs / WebContentsView
```

当前实现的关键事实：

| 部分     | 现状                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 统一入口 | 资源门面在 resources domain 内；Agent 另有 harness tools，不经过 Dispatcher    |
| 插件     | 插件 SDK 同时注册 transport / codec / presenter / sidecar / list / view action |
| 插件前端 | 页面通过 `window.extension` 使用页面会话与内容总线                             |
| 资源发现 | 侧栏列表 + 列表注册表；资源地图从列表生成 `AGENTS.md`                          |
| 资源地图 | 单份工作区 `AGENTS.md`，harness 读取后注入 context                             |
| Agent    | AgentHost / SessionsService；工具为固定资源工具 + office_gen                   |
| 操作     | 以 read / write / edit / query + 页面保存为主；Office 命令尚未统一             |
| 视图     | shell / assistant / overlay / capture + tabs；资源页 / 网页 / 设置 / 欢迎页    |

### 1.2 当前实现的模块边界

```text
Renderer pages
  shell / assistant / overlay / settings / welcome
  plugin frontend

Preload
  work-studio：subscribe / command / notify / update
  extension：页面会话 + 内容总线
  browser：网页视图
  capture：交互捕获

Main
  App（组合根 + IPC 生命周期）
  ├─ runtime：DomainRegistry / Dispatcher / storage / log / net / policy
  ├─ domains
  │   ├─ workspaces / resources / lists / plugins
  │   ├─ shell：windows / views / layout / scene / theme / dialogs / notices
  │   ├─ settings：settings / preferences / appearance / updates
  │   └─ agent：sessions / models / skills / thinking / extensions / tools / prompts / themes
  └─ agent：Agent Layer（pi runtime / harness / tools / sessions）
```

当前的核心耦合：

```text
workspace module（domain：workspaces / resources / lists / plugins）
  → WorkspacesRepo / Lists / Plugins
  → ResourcesService
  → URA runtime
      → PluginHost
      → UraRegistry（codec / transport / presenter / sidecar）
      → ResourcePipeline
      → PageSessions
      → ResourceMap（依赖 ListRegistry）
```

### 1.3 结构轴已落地

| 目标条目                           | 现状                                           |
| ---------------------------------- | ---------------------------------------------- |
| 主进程分层                         | Runtime / Domains / Agent Layer 已按职责分离   |
| DomainModule 依赖拓扑序            | 声明 `dependencies`，拓扑 start、反向 stop     |
| 作用域：工作区是 scope 不是 domain | workspace-scoped 资源以 `ws:<wsId>` 寻址       |
| 视图 / 布局 / 场景归 System 侧     | shell 管理窗口、视图、布局、主题、对话框与通知 |

### 1.4 能力轴尚未落地

| 核心判断               | 状态   | 说明                                                   |
| ---------------------- | ------ | ------------------------------------------------------ |
| 两类 Domain            | 未落地 | 无 system / business 区分；现有域都是 UI 状态域        |
| 插件即 Business Domain | 未落地 | 插件仍以 codec / presenter / sidecar / list 注册能力   |
| 取消全量清单           | 未落地 | 每工作区生成资源地图，harness 每轮注入 context         |
| 搜索下沉               | 部分   | 有全文检索，但无域归属、无 locator、无索引             |
| Locator 归 Domain      | 未落地 | 编辑用字节区间，未形成可跨调用传递的 locator           |
| 订阅只属于 UI          | 部分   | 实际只有页面订阅；但执行与订阅共用同一寻址，API 未分离 |
| 统一命令入口           | 未落地 | 页面走域命令，Agent 直调资源门面，两条路径并存         |

## 二、目标架构

### 2.1 总体结构

```text
┌─ Layer 1：Renderer 多页面 ──────────────────────────────────────┐
│ 传统 UI：shell / settings / welcome                             │
│ 插件前端：page / settings                                       │
│ Agent UI：assistant                                             │
└──────────────┬──────────────────────────────┬─────────────────┘
               │ preload bridge               │
               ▼                              ▼
┌─ IPCDispatcher ────────────────┐   ┌─ Layer 2：Agent harness ─┐
│ sender → origin                │   │ tools / context / skills │
│ subscribe / invoke / notify    │   │ ToolBinder               │
└──────────────┬─────────────────┘   └─────────────┬────────────┘
               │                                   │
               └────────────────┬──────────────────┘
                                ▼
┌─ App：DomainRegistry ───────────────────────────────────────────┐
│ declare · describe · invoke · notify · watch · onCapabilities   │
└───────────────┬───────────────────────────┬─────────────────────┘
                ▼                           ▼
┌─ System Domains ────────────────┐  ┌─ Business Domains（Plugins）────┐
│ windows · views · pages         │  │ files · office · docs · email   │
│ sessions · settings · theme     │  │ read · ls · find · search       │
│ layout · dialogs                │  │ execute(op, target, input)      │
│                                 │  │                                 │
│ 管理应用运行时                  │  │ catalog · search index          │
│ 不进入 Agent 工具面             │  │ locator · document model        │
│                                 │  │ 自有前端与 engine               │
└─────────────────────────────────┘  └──────────────┬──────────────────┘
                                                    ▼
                                       ┌─ Domain engine ──────────────┐
                                       │ OOXML / PDF / Markdown       │
                                       │ CLI / native API / script    │
                                       └──────────────────────────────┘
```

层级说明：

- **Layer 1：Renderer 多页面**：传统 UI、插件前端、Agent UI 是不同页面，不是同一个消费者框。
- **IPCDispatcher**：只处理 sender → origin、订阅归属、请求/响应与 IPC 日志；不承载业务路由。
- **Layer 2：Agent harness**：独立层，只服务 Agent UI；包含 ToolBinder，直接调用 DomainRegistry。
- **DomainRegistry**：能力图与执行闸门；四个动词覆盖声明、发现、执行、订阅。
- **System / Business Domain**：按 `type` 区分；System Domain 不进入 Agent 工具面。
- **Domain engine**：Business Domain 内部的 OOXML / PDF / CLI / native 实现。

### 2.2 一条契约，三种投影

统一发生在契约层，不在传输层：

```text
DomainRegistry.declare()
  → 能力图（manifest · state · ops）
      ├─ describe(ui)    → 命令面板 / 权限提示 / 状态命令绑定
      ├─ describe(tool)  → ToolBinder：schema · exposure · annotations
      └─ 技能目录        → 由 describe(tool) 生成，只读，无运行时

DomainRegistry.invoke(origin, request)
      ├─ bridge：结构化结果 → 视图
      ├─ tool：project() → 文本 + structuredContent
      └─ 进度：UI → event，tool → onUpdate
```

三种投影共享同一份 schema、同一份授权表、同一份日志；差异只在**投递形态**。

### 2.3 两条轴

| 轴     | 入口                    | 消费者                       | 是否给 Agent         |
| ------ | ----------------------- | ---------------------------- | -------------------- |
| 订阅轴 | `watch(owner, address)` | 页面                         | 否                   |
| 执行轴 | `invoke` / `notify`     | 页面 / 插件页 / Agent / 技能 | 是（按 exposure）    |
| 事件轴 | `event` / `emit`        | 页面 / 域之间                | 否（进度随执行返回） |

- 订阅只属于 UI：Agent 不订阅，它在轮次里取快照或执行 op。
- 命令两端共用：页面按钮、命令面板、工具调用、技能步骤产出同一个 `DomainRequest`。
- 结果由 Domain 双投影：结构化值给 UI 与程序化调用，文本投影给模型。
- `notify` 不是第二条通道，而是执行轴的无回执投递，仅限安全且无输出的 op。

### 2.4 核心判断

1. **Domain 分两类**：System Domain 管理系统运行时；Business Domain 管理业务能力与业务资源。
2. **插件就是 Business Domain**：插件不再只是 codec 注册表，而是业务能力的完整入口。
3. **订阅只属于 UI**：Agent 通过 op 与 `detail` 取所需，不持有跨轮状态。
4. **统一在能力图**：`describe` 是唯一能力来源，命令面板、工具声明、技能目录都由它生成。
5. **搜索下沉到 Domain**：命中必须由 Domain 返回 `ref + locator`；没有 locator 只能作为只读线索。
6. **Locator 泛型化**：locator 的具体类型由 Domain 决定，DomainRegistry 只透传，不解释。
7. **没有全量清单**：不再维护全量文件目录 context；业务发现由 Domain 的 `search` / `ls` / `find` 完成。

## 三、Domain 声明模型

### 3.1 两类 Domain

```ts
interface DomainManifest {
  id: string;
  type: 'system' | 'business';
  label: string;
  description?: string;
  scope?: 'app' | 'workspace';
  mimes?: readonly string[];
}
```

| 类型            | 例子                                                                     | 职责                             |
| --------------- | ------------------------------------------------------------------------ | -------------------------------- |
| System Domain   | windows / views / pages / sessions / settings / theme / layout / dialogs | 应用运行时、窗口、视图、状态管理 |
| Business Domain | files / office / docs / sheets / email                                   | 业务资源、业务搜索、业务操作     |

System Domain 不声明工具暴露；Business Domain 必须实现发现与执行 op。

### 3.2 声明对象

```ts
interface DomainDeclaration {
  manifest: DomainManifest;
  dependencies?: readonly string[];
  state?: Record<string, StateDeclaration>;
  ops?: Record<string, OpDeclaration>;
  start?(ctx: DomainScope): void | Promise<void>;
  stop?(): void | Promise<void>;
}

interface StateDeclaration<T = unknown> {
  /** 全量投影；watch 与 publish 共用同一份。 */
  snapshot(ctx: DomainScope): T;
}

interface OpDeclaration<I = unknown, O = unknown, L = unknown> {
  title: string;
  description?: string;

  /** 参数 schema：IPC、工具声明、执行前校验三处共用。 */
  input: TSchema;
  output?: TSchema;
  /** Locator schema；由 Domain 定义，Registry 只透传。 */
  target?: TSchema;

  /** 归属投影；省略表示域级业务 op。 */
  resource?: string;

  mutates?: boolean;
  danger?: 'safe' | 'confirm' | 'destructive';

  /** 成功后自动推送的投影。 */
  invalidates?: readonly string[];
  /** 成功后发出的事件。 */
  emits?: readonly string[];

  /** Agent 面声明；缺省按 manifest.type 推导。 */
  tool?: { exposure: 'direct' | 'codemode' | 'deferred' | 'hidden' };
  /** 结构化结果 → 模型文本；缺省 JSON + detail 截断。 */
  project?(value: O, io: OpIo): string;

  run(input: I, ctx: OpContext<L>): O | Promise<O>;
}

interface OpContext<L = unknown> {
  origin: Origin;
  ref?: string;
  target?: L;
  signal: AbortSignal;
  detail: 'summary' | 'full';
  progress(stage: string, data?: unknown): void;
  state: DomainScope;
}
```

`OpContext` 是 Domain 唯一可见的执行环境：来源、寻址、取消、粒度、进度与投影写入。Domain 不接触视图、IPC、pi 或原生句柄。

### 3.3 五类 op 与暴露

| op 类别     | 例子                                          | 暴露                    | 效果                   |
| ----------- | --------------------------------------------- | ----------------------- | ---------------------- |
| 发现        | `read` / `ls` / `find` / `search`             | `direct`                | 稳定声明，模型总能看到 |
| 业务细粒度  | `office.slide.add` / `docs.paragraph.replace` | `codemode` / `deferred` | 注册但不声明，按需发现 |
| 写入 / 危险 | `office.create` / `files.replace`             | `direct` + 危险等级     | 权限确认据此触发       |
| 状态命令    | `tabs.activate` / `scene.patch`               | 不暴露                  | 只有 UI 可调用         |
| 页面会话    | `page.get` / `page.save`                      | 不暴露                  | 由页面宿主私有协议承载 |

- 注册量不等于声明量：`codemode` / `deferred` 让 op 数量不进入 context。
- 状态命令与页面会话不是另一套协议，它们只是不暴露给 Agent 的 op。
- 工具名以 Domain 为命名空间，`read` / `write` 等短名跨域共存，不与外部工具名冲突。

### 3.4 注册期校验

框架的职责是让错误形状表达不出来。以下情况在声明期直接失败：

| 校验                                   | 目的                     |
| -------------------------------------- | ------------------------ |
| System Domain 声明了工具暴露           | 系统域永不进入工具面     |
| Business Domain 缺少 `read` / `search` | 业务契约完整             |
| `mutates` 未声明 `danger`              | 写操作必须显式定级       |
| `input` / `output` 不是合法 schema     | 双端 schema 同源         |
| `resource` 指向未声明的 state          | 状态命令不能挂空投影     |
| `invalidates` 指向未声明的 state       | 失效声明可验证           |
| 同域 op 重名，或跨域重名未命名空间     | 命令面板与工具名不冲突   |
| `notify` 可达的 op 非 `safe` 或带输出  | 无回执通道不能承载写操作 |

### 3.5 作用域

| 范围      | 内容                                                   |
| --------- | ------------------------------------------------------ |
| App       | Domain 清单、catalog、模型、凭证、全局设置、工作区列表 |
| Workspace | 业务资源、索引、缓存、页面会话、会话索引、项目设置     |

- 业务 Domain 的工作区实例以 `ws:<wsId>` 寻址；切换工作区即换实例，旧索引、缓存、locator 一并失效。
- catalog 是 App 级：它只列能力与域，不列文件。

## 四、DomainRegistry

### 4.1 四个动词与注册原语

```ts
interface DomainRegistry {
  declare(decl: DomainDeclaration): void;
  /** 增量注册原语；declare 是它们的原子封装。 */
  registerState(domain: string, name: string, decl: StateDeclaration): void;
  registerOp(domain: string, name: string, decl: OpDeclaration): void;

  describe(
    origin: Origin,
    filter?: { domain?: string; op?: string },
  ): CapabilityView;

  invoke<R = unknown>(
    origin: Origin,
    request: DomainRequest,
    io?: Partial<OpIo>,
  ): Promise<CallResult<R>>;

  notify(origin: Origin, request: DomainRequest, io?: Partial<OpIo>): void;

  watch(owner: WatchOwner, address: ResourceAddress): Promise<unknown>;
  unwatch(owner: WatchOwner, address: ResourceAddress): void;

  onCapabilities(listener: (change: CapabilityChange) => void): () => void;
}

interface DomainRequest {
  domain: string;
  op: string;
  /** 状态命令承载的投影；业务 op 省略。 */
  resource?: string;
  ref?: string;
  target?: unknown;
  input?: unknown;
}

interface ResourceAddress {
  domain: string;
  resource: string;
}

type WatchOwner = Extract<Origin, { type: 'view' }>;

/** 对外能力描述：声明去掉 run 与 project。 */
interface OperationDescriptor {
  domain: string;
  name: string;
  title: string;
  description?: string;
  input: TSchema;
  output?: TSchema;
  target?: TSchema;
  resource?: string;
  mutates?: boolean;
  danger?: 'safe' | 'confirm' | 'destructive';
  tool?: { exposure: 'direct' | 'codemode' | 'deferred' | 'hidden' };
}

interface CapabilityView {
  domains: DomainManifest[];
  ops: OperationDescriptor[];
}

interface OpIo {
  signal?: AbortSignal;
  detail?: 'summary' | 'full';
  progress?(stage: string, data?: unknown): void;
}
```

- `origin` 是必填参数：不存在不携带来源的执行路径。
- `declare` 与增量原语共用同一套注册期校验。
- `describe` 与 `invoke` 共用同一份 manifest 与 schema，不存在“文档一套、实现一套”。
- 域注册与撤销都触发 `onCapabilities`，适配器据此重建工具、命令与技能目录。

### 4.2 invoke 流程

```text
1. origin → audience           view / page / service / tool
2. 查找声明                    未注册 → denied
3. 授权矩阵                    audience × danger → allow / confirm / deny
4. 参数校验                    schema → invalid
5. 执行环境装配                signal · detail · progress · state
6. 执行 run()                  mutates 按 (domain, ref) 串行
7. 失效传播                    publish(invalidates) + emit(emits)
8. 结果归一与记录              CallResult + 来源 / 域 / op / 耗时
```

- 第 6 步的串行队列保证同一资源上的写操作不交错；Domain 不各自实现写锁。
- 第 7 步把两条轴绑在一起：op 成功即投影更新，Domain 不手工 `publish`。
- 第 8 步的记录覆盖 UI 与 Agent：工具调用第一次与页面命令出现在同一份日志里。

### 4.3 notify

`notify` 与 `invoke` 共用同一个闸门，只去掉回执。它只对声明为 `safe` 且无输出的 op 开放，用于布局拖拽、场景补丁这类高频动作。写操作无法走无回执通道，因此不会静默失败。

### 4.4 授权矩阵

| origin                         | System Domain | 本域 business                | 跨域 business    |
| ------------------------------ | ------------- | ---------------------------- | ---------------- |
| `view(shell/settings/welcome)` | 全权          | read / execute（危险需确认） | 只读             |
| `view(page, pluginId=X)`       | 仅页面会话    | 全权                         | 只读且需显式声明 |
| `service`                      | 全权          | 全权                         | 全权             |
| `tool`                         | 拒绝          | 按 exposure                  | 按 exposure      |

- 插件页只能执行本域 op；跨域读取需要在清单中声明，并在日志中留痕。
- 工具面看不到 System Domain，即使它声明了 op。
- 危险 op 的确认在 UI 由对话框承担，在 Agent 由权限扩展承担；两者读取同一份 `danger` 与注解。

### 4.5 IPCDispatcher 只做传输

```ts
interface IPCDispatcher {
  subscribe(sender, address): Promise<unknown>;
  unsubscribe(sender, address): void;
  invoke(sender, request): Promise<CallResult>;
  notify(sender, request): void;
}
```

职责：sender → origin、订阅归属与释放、协议与日志、把请求交给 `registry`。

不负责：Domain 业务逻辑、工具注入、Locator 解释、搜索策略、授权判定。

### 4.6 ToolBinder

```text
registry.describe(tool)
  → 每个 op 一条工具声明
      name        = domain + '.' + op
      namespace   = domain
      parameters  = op.input
      outputSchema= op.output
      annotations = readOnlyHint / destructiveHint
      exposure    = op.tool.exposure
  → pi.registerTool
  → onCapabilities 变化时重建
```

ToolBinder 是纯投影：不写业务格式化、不做截断、不判断权限。工具结果的文本由 `op.project` 或通用投影产出。

## 五、搜索与 Locator

### 5.1 用 catalog 取代全量清单

不再维护一份全量文件目录作为 context。替代结构很小：

```text
Domain catalog（App 级，很小）
  ├─ files：文本与目录
  ├─ office：docx / xlsx / pptx
  └─ docs：Markdown / PDF

Domain.search(query)
  → SearchHit { domain, ref, locator, snippet }
  → Domain.read / Domain.execute
```

理由：全量目录无法为每个条目提供操作 locator；搜索结果没有 locator 就无法进入下一步；业务发现应由 Domain 自己负责。

### 5.2 Domain 自有搜索

每个 Business Domain 负责自己的：

```text
Markdown 缓存
搜索索引
locator 提取
结果排序与预算
```

Office 域的闭环：

```text
docx / xlsx / pptx
  → 解析为 Document
  → 生成 Markdown 缓存
  → 建立带 locator 的搜索索引
  → search(query) 返回 sheet / cell、slide / shape、paragraph locator
```

```ts
{
  domain: 'office',
  ref: 'file:///.../sales.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  snippet: '华东 | 1200',
  locator: { type: 'sheet-cell', sheet: '2026Q1', range: 'B2' },
  actionable: true,
}
```

### 5.3 Locator 归 Domain

`Locator` 是 Domain 自己的类型。Registry 只保证一条约定：

```text
search 返回的 locator
  → 可以传给同一 Domain 的 execute
```

Domain 负责 schema、验证、失效处理与文档模型映射。不同 Domain 的 locator 完全不同：

```ts
{ type: 'sheet-cell', sheet: 'Q1', range: 'B2' }   // office
{ type: 'thread', threadId: '...' }                // email
{ type: 'paragraph', blockId: 'p-17' }             // docs
```

locator 携带内容基线（版本或片段哈希）。基线失效时返回 `stale` 错误，不静默错位。

### 5.4 无 locator 的命中

```ts
{
  domain: 'pdf',
  ref: 'file:///.../scan.pdf',
  snippet: '...',
  actionable: false,
}
```

`actionable: false` 不能直接 `execute`，只能作为阅读线索；Domain 可以提供显式的 `locate` / `open` 操作把线索转成 locator。

### 5.5 结果双投影

```text
Domain 返回结构化值
  ├─ UI / 程序化调用：原样
  └─ 模型：op.project()；缺省 JSON + detail 截断
```

- `detail: 'summary' | 'full'` 由调用者选择，由 Domain 解释：摘要给模型，全文给 UI。
- 截断与分页归 Domain：只有它知道从哪里切不断结构。
- 适配器不做业务截断，也不做业务格式化。
- 工具结果同时携带文本与 `structuredContent`：模型读文本，codemode 脚本与技能直接取数据，不需要解析自然语言。

### 5.6 跨域搜索

全局搜索由 Registry 扇出并统一预算：

```text
registry.invoke(origin, { domain: '*', op: 'search', input: { query } })
  → 各 Business Domain 并发搜索（超时 + 命中预算）
  → 合并、去重、按 score 排序
```

- `domain: '*'` 只对 Business Domain 全部声明的发现类 op 有效（read / ls / find / search），其余 op 必须指定域。
- 每个 Domain 有独立的超时与命中上限，单个域失败不影响其余域。
- `domain` 作为过滤器传给工具与命令面板，避免模型盲扫。

## 六、Domain 内部组织

```text
Business Domain（plugin）
├─ manifest：id / label / mimes / 前端出口
├─ ops
│   ├─ read / ls / find / search
│   └─ execute(op, target, input)
├─ frontend
│   └─ page / settings
├─ index
│   ├─ Markdown cache
│   └─ locator index
└─ engine
    ├─ codec / parser
    ├─ document model
    └─ native operations
```

- codec / transport 不是独立的上层概念，它们是 Domain 内部实现细节。
- Domain 可以包装 CLI、Python 脚本、原生库或 WASM 引擎；Agent 只看到 op。
- 索引落在 App 空间下按工作区隔离的缓存目录，不进工作区内容区；Domain 卸载或工作区切换即删除。
- Domain 安装/卸载时，自己的索引、缓存、前端页面与操作一起失效；该失效由 Registry 的能力变更统一触发。

## 七、当前实现与差距

### 7.1 已经具备

- DomainRegistry / Dispatcher 与 DomainModule 依赖拓扑序；
- workspace / shell / settings / agent 四个生命周期模块；
- workspace-scoped 资源以 `ws:<wsId>` 作为路径条件；
- 资源管道（transport / codec / pipeline / page session）与资源地图；
- Agent 工具、插件安装、设置页与传统 UI。

### 7.2 核心判断的状态

| 判断                   | 状态   | 差距                                             |
| ---------------------- | ------ | ------------------------------------------------ |
| 两类 Domain            | 未落地 | 无 `type` 区分；现有域全部按 UI 状态组织         |
| 插件即 Business Domain | 未落地 | 插件注册的是 codec / presenter / sidecar / list  |
| 取消全量清单           | 未落地 | 资源地图仍是注入 context 的主发现通道            |
| 搜索下沉               | 部分   | 检索无域归属、无索引、无 locator                 |
| Locator 归 Domain      | 未落地 | 只有字节区间，未形成跨调用可传递的 locator       |
| 订阅只属于 UI          | 部分   | 实际只有页面订阅；执行与订阅共用同一寻址         |
| 统一命令入口           | 未落地 | 页面与 Agent 是两条路径，工具也不经过 Dispatcher |

### 7.3 差距表

| 主题        | 当前实现                                | 目标                            |
| ----------- | --------------------------------------- | ------------------------------- |
| 统一入口    | 资源门面 + 域命令双入口                 | Registry `invoke` 单一闸门      |
| 插件        | codec / transport / presenter / sidecar | Business Domain 的 op 与前端    |
| 资源发现    | 全量清单 + 资源地图                     | Domain catalog + Domain search  |
| 搜索        | 全文扫描 / glob / 结构化查询            | Domain.search，带 locator       |
| Locator     | 字节区间，仅编辑路径可见                | Domain 泛型 locator，跨调用传递 |
| 操作        | 固定工具 + 部分 Office 命令             | `execute(op, target, input)`    |
| 工具面      | 手写工具，各自格式化结果                | `describe` 生成，project 投影   |
| UI 与 Agent | 两套调用路径                            | 同一个 `DomainRequest`          |
| 命令扩展    | 每类操作新增一条命令与一个工具          | 新增一个 op 声明                |

### 7.4 资源管道各段的去向

| 现有概念      | 去向                | 处理                                   |
| ------------- | ------------------- | -------------------------------------- |
| transport     | 共享内核            | 保留为注入依赖，不再按 scheme 全局抢注 |
| codec         | Domain 私有 engine  | 不再注册；Domain 内按 MIME 选择        |
| presenter     | Domain frontend     | 由 manifest 声明页面出口               |
| sidecar       | `read` 的投影       | 变成 `detail` 参数与 `project`         |
| store / query | Domain op           | 变成 `execute` 的命名空间操作          |
| binding       | Domain 设置         | 从全局绑定表降到 Domain 作用域         |
| view action   | Domain frontend     | 随 Domain 卸载                         |
| 列表 provider | Domain catalog      | 侧栏是 catalog 的投影                  |
| 资源地图      | 删除                | 由 catalog 与 `search` 取代            |
| 页面会话      | System Domain pages | 从资源域拆出，不进 Agent 工具面        |

## 八、需要坚守的规则

- **没有 URA / Domain Gateway 独立层**：统一入口由 Registry 的 `invoke` 承担。
- **插件就是 Business Domain**：插件负责资源、搜索、操作与前端。
- **System / Business 分离**：窗口、视图、会话、设置不进业务插件，也不进工具面。
- **订阅只属于 UI**：Agent 通过 op 与 `detail` 取数，不持有订阅。
- **能力面只有一个来源**：命令面板、工具声明、技能目录都由 `describe` 生成。
- **搜索必须带 locator**：没有 locator 的命中只能阅读，不能直接执行。
- **Locator 归 Domain**：Registry 只透传，schema 由 Domain 定义。
- **命令统一**：UI、插件页、Agent、技能都产出同一个 `DomainRequest`。
- **注册量不等于声明量**：细粒度 op 用 `codemode` / `deferred`，不为每个 op 声明工具。
- **结果双投影**：结构化值给 UI 与脚本，文本投影给模型；截断归 Domain。
- **Domain 自有缓存**：索引、Markdown 缓存、locator 索引随 Domain 与工作区生命周期管理。
- **不暴露裸 shell**：Domain 可以内部包装 CLI 或脚本，Agent 只看到 op。
- **写操作收口**：所有变更都走 `invoke`，`mutates` 串行，不做旁路写入。

## 九、收敛顺序

每个里程碑独立可验收；代码改动按 `pnpm verify` 收口，UI / 交互改动按 `dev_test` 与隔离 e2e 收口。

| 里程碑 | 内容                                                                                                                                     | 完成定义                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M0     | 冻结契约：manifest、声明对象、请求与执行环境类型                                                                                         | 类型落地，`pnpm verify` 通过，运行时行为不变                   |
| M1     | Registry 新 API：`declare` / `describe` / `invoke` / `notify` / `watch` / `onCapabilities`，含注册期校验与授权矩阵；旧注册面降为增量原语 | 现有域全部经增量原语注册且行为不变；e2e 全量通过               |
| M2     | `files` Domain：五个 op 包住现有资源管道；页面改走 `invoke`；工具由 ToolBinder 生成                                                      | UI 与 Agent 同一 op 同一结果；工具调用出现在日志；手写工具删除 |
| M3     | 发现模型切换：`search` 返回带 locator 的命中；删除资源地图；技能目录由 `describe` 生成                                                   | search → execute 闭环；工作区不再生成清单文件；目录与 op 一致  |
| M4     | 拆分页面会话：资源域拆成 `pages`（System）与 `files`（Business）；插件页使用页面会话与域执行两条通道                                     | 页面保存 / 重读 / 冲突 e2e 全绿；插件页只能执行本域 op         |
| M5     | 插件升级为 Business Domain：清单声明域与前端出口；旧注册入口映射为单域                                                                   | 三个内置插件迁移；已安装的旧插件仍可装载                       |
| M6     | Office Domain：OOXML engine、Markdown 缓存、带 locator 的索引；生成脚本收进 Domain                                                       | docx / xlsx / pptx 可读可搜可改；生成不再暴露为独立工具        |
| M7     | 清尾：删除资源门面、全局注册表、绑定表与资源地图                                                                                         | 卸载 Domain 后命令、工具、页面、索引同时失效                   |

顺序理由：先把入口与契约做实，再用最简单的文件域验证闭环，最后才动插件与 Office。反过来会得到两个并行系统。

## 十、待确认

- 跨域只读是否对所有 Domain 开放，还是只能由清单显式声明？（当前建议：显式声明）
- 一个插件是否可以注册多个 Business Domain，还是保持一插件一域？（当前建议：一插件一域）
- System Domain 是否允许 `service` 来源之外的调用方执行状态命令？（当前建议：不允许）
