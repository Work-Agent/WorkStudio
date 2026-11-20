# 目标架构：Business Domain 与统一命令入口

> 本文描述 WorkStudio 的目标架构，并对照当前实现。目标架构取消 URA 作为独立层，把资源发现、读取与操作收进 Business Domain；DomainRegistry 负责统一 dispatch，IPCDispatcher 只做 IPC 传输与来源路由。当前稳定实现见 [架构设计](./architecture.md)。

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
│          thinking / extensions / tools / prompts / themes                                      │
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

| 部分     | 现状                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 统一入口 | URA facade 在 resources domain 内；Agent 另有 harness tools                      |
| 插件     | plugin SDK 同时注册 transport / codec / presenter / sidecar / list / view action |
| 插件前端 | 页面通过 `window.extension` 使用页面会话与内容总线                               |
| 资源发现 | 侧栏列表 + `listRegistry`；资源地图从列表生成 `AGENTS.md`                        |
| 资源地图 | 单份工作区 `AGENTS.md`，harness 读取后注入 context                               |
| Agent    | AgentHost / SessionsService；工具为固定 URA tools + office_gen                   |
| 操作     | 以 URA read/write/edit/query + 页面保存为主；Office 命令尚未统一                 |
| 视图     | shell / assistant / overlay / capture + tabs；资源页 / 网页 / 设置 / 欢迎页      |

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

资源地图不是独立的 Domain Gateway，也不是 Domain 自有搜索索引；它是 URA runtime 内部由列表驱动的 `AGENTS.md` 生成器。

### 1.3 与目标的差异概览

| 当前                                                 | 目标                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| URA facade 作为资源入口                              | DomainRegistry 统一 dispatch               |
| codec / transport / presenter / sidecar 混合插件 SDK | Business Domain tools                      |
| 列表 + 单份 `AGENTS.md`                              | Domain catalog + Domain 自有搜索 / locator |
| Agent 固定 URA tools                                 | domain.read / ls / find / search / execute |
| locator 分散在 URA / 页面会话                        | Locator 泛型，归 Business Domain           |
| 传统 UI 走 resources / lists / plugins domain        | 传统 UI 与 Agent 共用 Domain 命令入口      |

> 下面开始描述目标架构。

## 二、目标架构

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
│ subscribe / unsubscribe        │   │ ToolBinder                │
│ command → registry.dispatch    │   └─────────────┬────────────┘
└──────────────┬─────────────────┘                 │ registry.dispatch
               └──────────────────┬────────────────┘
                                  ▼
┌─ App：DomainRegistry ───────────────────────────────────────────┐
│ domains · describe · resources · tools · dispatch               │
└───────────────┬───────────────────────────┬───────────────────┘
                ▼                           ▼
┌─ System Domains ────────────────┐  ┌─ Business Domains（Plugins）────┐
│ windows · views · providers     │  │ office · docs · sheets · slides │
│ sessions · settings · theme     │  │ email · files                  │
│ layout · dialogs                │  │ read · ls · find · search      │
│                                 │  │ execute(op, target, input)     │
│ 管理应用运行时                  │  │ Markdown cache · search index  │
│ 不进入 Agent 工具面             │  │ locator · document model       │
└─────────────────────────────────┘  └──────────────┬─────────────────┘
                                                    │
                                       ┌─ Domain engine ──────────────┐
                                       │ OOXML / PDF / Markdown       │
                                       │ CLI / native API / script    │
                                       └──────────────────────────────┘
```

层级说明：

- **Layer 1：Renderer 多页面**：传统 UI、插件前端、Agent UI 是不同页面，不是同一个消费者框。
- **IPCDispatcher**：只处理 sender → origin、订阅归属、请求/响应与 IPC 日志；不承载业务路由。
- **Layer 2：Agent harness**：独立层，只服务 Agent UI；包含 ToolBinder，直接调用 DomainRegistry。
- **DomainRegistry**：Domain 注册、命令表、资源/工具描述与 dispatch；不是额外的业务层。
- **System / Business Domain**：DomainRegistry 下分两类；System Domain 不进入 Agent 工具面。
- **Domain engine**：Business Domain 内部的 OOXML / PDF / CLI / native 实现。

核心约束：

- **没有 URA 独立层**：统一 dispatch 由 DomainRegistry 承担。
- **没有 Domain Gateway 层**：IPCDispatcher 只做传输，DomainRegistry 只做注册与分发。
- **没有 L1 资源树**：业务发现由 Business Domain 的 `search` / `ls` / `find` 完成。
- **插件 = Business Domain**：插件拥有资源、搜索、locator、操作和前端。
- **Agent harness 是独立层**：Agent UI → harness → DomainRegistry；传统 UI → IPCDispatcher → DomainRegistry。

### 搜索到执行的闭环

```text
User / Agent
  → DomainRegistry.dispatch({
      op: 'search',
      domain?, query,
    })
  → Business Domain.search
  → SearchHit {
      domain, ref, snippet,
      locator,
      actionable,
    }
  → DomainRegistry.dispatch({
      domain,
      op,
      ref,
      target: locator,
      input,
    })
```

有 `locator` 的命中才能直接执行；没有 `locator` 的命中只能作为只读线索。

## 三、核心判断

WorkStudio 不应该再有独立的 URA 层。原有 URA 的职责拆到两处：

```text
Business Domain（Plugin Domain）
  ├─ read / ls / find / search
  ├─ execute(operation, target, input)
  ├─ 领域搜索索引 / Markdown 缓存
  └─ 领域特有的 locator 与文档模型

DomainRegistry
  ├─ 列出 Domain
  ├─ 描述操作
  ├─ 路由搜索 / 执行
  └─ 给 Agent、传统 UI、插件前端提供同一入口
```

传统 UI、插件前端和 Agent harness 不再各自维护资源读取器：

```text
传统 UI 页面 ─┐
Agent harness ─┼─► DomainRegistry ─► Business Domain ─► 真实资源
Skills ───────┘
```

核心判断：

1. **Domain 分两类**：System Domain 管理系统运行时；Business Domain 管理业务能力与业务资源。
2. **插件就是 Business Domain**：插件不再只是 codec 注册表，而是业务能力的完整入口。
3. **没有 L1 资源树**：不再维护全量文件目录 context；业务发现由 Domain 的 `search` / `ls` / `find` 完成。
4. **搜索下沉到 Domain**：搜索结果必须由 Domain 返回 `ref + locator`；没有 locator 的命中只能作为只读线索。
5. **Locator 泛型化**：locator 的具体类型由 Domain 决定，DomainRegistry 只透传，不解释。
6. **统一命令入口**：`read / ls / find / search / execute` 在 Agent、传统 UI 与插件前端中走同一个 command envelope。

## 四、Domain 模型

### 4.1 两类 Domain

```ts
type DomainKind = 'system' | 'business';

interface DomainManifest {
  id: string;
  kind: DomainKind;
  label: string;
  description?: string;
  mimes?: readonly string[];
  tools?: readonly DomainToolName[];
}
```

| 类型            | 例子                                                                         | 职责                             |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| System Domain   | windows / views / providers / sessions / settings / theme / layout / dialogs | 应用运行时、窗口、视图、状态管理 |
| Business Domain | office / docs / sheets / slides / email / files                              | 业务资源、业务搜索、业务操作     |

System Domain 不实现 Agent 工具接口；Business Domain 必须实现工具接口。

### 4.2 Business Domain 契约

```ts
type Locator = unknown;

interface SearchHit<L = Locator> {
  domain: string;
  ref: string;
  mime?: string;
  snippet: string;
  locator?: L;
  /** 有可执行 locator 时才能直接进入 execute */
  actionable: boolean;
  score?: number;
}

interface BusinessDomain<L = Locator> {
  readonly manifest: DomainManifest;

  read(input: {
    ref: string;
    target?: L;
    detail?: 'summary' | 'full';
  }): Promise<unknown>;

  ls(input: { ref: string; limit?: number }): Promise<unknown>;

  find(input: {
    query: string;
    scope?: string;
    limit?: number;
  }): Promise<SearchHit<L>[]>;

  search(input: {
    query: string;
    scope?: string;
    limit?: number;
  }): Promise<SearchHit<L>[]>;

  execute(input: {
    ref: string;
    op: string;
    target?: L;
    input?: unknown;
  }): Promise<unknown>;
}
```

约束：

- `Locator` 是泛型；DomainRegistry 不解析、不构造、不修改。
- Domain 在自己的操作描述里声明 `targetSchema`，供 UI 和 Agent 了解 locator 结构。
- `search` 返回的 `locator` 必须能直接作为 `execute.target`；不能直接执行的命中标记 `actionable: false`。
- `read` / `ls` / `find` / `search` 是发现与读取工具；`execute` 是业务操作工具。
- `write` 不再作为跨 Domain 的通用方法；文本 Domain 可以提供 `op: 'write'`，Office 使用自己的命名空间操作。

### 4.3 操作描述

```ts
interface OperationDescriptor {
  domain: string;
  name: string;
  title: string;
  description?: string;
  input: JsonSchema;
  output?: JsonSchema;
  targetSchema?: JsonSchema;
  mutates?: boolean;
  danger?: 'safe' | 'confirm' | 'destructive';
}
```

- `name` 在 Domain 内唯一，建议命名空间化：`office.slide.add`、`email.send`。
- `targetSchema` 描述 `Locator`；由 Domain 定义，DomainRegistry 只透传。
- `input` / `output` 用于 UI 表单、Agent 工具参数校验与技能文档。
- 命令很多时不生成大量 tool；通过 `describe` 发现，通过 `execute` 执行。

## 五、DomainRegistry 与 IPCDispatcher

### 5.1 注册与分发

`DomainRegistry` 是 App 内的运行时组件，不是额外业务层：

```ts
interface DomainCommand<L = Locator> {
  domain: string;
  /** read / ls / find / search / 业务 op */
  op: string;
  ref?: string;
  target?: L;
  input?: unknown;
}

interface DomainRegistry<L = Locator> {
  register(domain: SystemDomain | BusinessDomain<L>): void;
  unregister(domainId: string): void;

  domains(): DomainManifest[];
  describe(domain: string, op?: string): OperationDescriptor[];
  tools(): ToolDescriptor[];

  dispatch(origin: Origin, command: DomainCommand<L>): Promise<unknown>;
}
```

`dispatch` 是唯一业务分发入口：

```text
DomainCommand
  → domain 查找
  → SystemDomain：命令 / 资源
  → BusinessDomain：read / ls / find / search / execute
  → 结果 / 错误
```

- 注册时校验 Domain id、manifest、工具方法。
- Business Domain 必须实现 `read / ls / find / search / execute`。
- System Domain 不进入 Agent 工具面，但仍可通过 dispatch/UI 命令使用。
- `dispatch` 不解释 Locator；Domain 自己校验 target。
- `tools()` 返回 Agent 可注入的工具描述；不是 IPC 协议的一部分。

### 5.2 IPCDispatcher 只做传输

```ts
interface IPCDispatcher {
  subscribe(sender, domain, resource): Promise<unknown>;
  unsubscribe(sender, domain, resource): void;
  command(sender, command: DomainCommand): Promise<unknown>;
  notify(sender, command: DomainCommand): void;
}
```

职责：

- sender → origin
- 订阅归属与释放
- command / notify 协议
- IPC 日志（开关：`ipcLog` / `WA_IPC_LOG`）
- 把 `command` 交给 `registry.dispatch(origin, command)`

不负责：

- Domain 业务逻辑
- Tool 注入
- Locator 解释
- Search 策略

### 5.3 Agent ToolBinder

Agent harness 是独立第二层，内部有 ToolBinder：

```text
DomainRegistry.tools()
  → ToolBinder
  → 稳定工具：domain.read / domain.ls / domain.find / domain.search / domain.execute
  → tool call → registry.dispatch()
```

ToolBinder 负责：

- 根据 Domain 的 tool descriptor 注入工具
- 过滤 exposure / 权限
- 维护会话内的工具集合
- Domain 注册/卸载时刷新工具

IPCDispatcher 不参与 ToolBinder；Tool 注入属于 Agent 能力面，不属于 IPC 传输面。

### 5.4 传统 UI 与插件前端

- 传统 UI：preload bridge → IPCDispatcher → DomainRegistry.dispatch。
- 插件前端：受限页面会话 → IPCDispatcher → DomainRegistry.dispatch。
- Agent harness：ToolBinder → DomainRegistry.dispatch（主进程内直连）。
- 三者的最终命令都是同一个 `DomainCommand`。

UI 的按钮、命令面板、右键菜单和 Agent 工具都映射为：

```text
DomainCommand { domain, op, ref, target, input }
```

## 六、搜索与 Locator

### 6.1 取消 L1 资源树

不再维护一份全量文件目录树作为 context。原因：

- L1 目录树无法为每个文件提供操作 locator；
- 搜索结果如果没有 locator，无法进入下一步；
- 业务发现应该由 Domain 自己负责。

替代结构：

```text
Domain catalog（很小）
  ├─ office：docx / xlsx / pptx
  ├─ email：邮件
  └─ docs：Markdown / PDF

Domain.search(query)
  → SearchHit { domain, ref, locator, snippet }
  → Domain.read / Domain.execute
```

Domain catalog 只列业务域与能力，不列文件。

### 6.2 Domain 自有搜索

每个 Business Domain 负责自己的：

```text
Markdown 缓存
搜索索引
locator 提取
搜索结果排序
```

例如 Office Domain：

```text
docx / xlsx / pptx
  → 解析为 Document
  → 生成 Markdown 缓存
  → 建立带 locator 的搜索索引
  → search(query) 返回 sheet/cell、slide/shape、paragraph locator
```

搜索结果示例：

```ts
{
  domain: 'office',
  ref: 'file:///.../sales.xlsx',
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  snippet: '华东 | 1200',
  locator: {
    type: 'sheet-cell',
    sheet: '2026Q1',
    range: 'B2',
  },
  actionable: true,
}
```

### 6.3 Locator 归 Domain

`Locator` 是插件自己的类型。DomainRegistry 只保证：

```text
search 返回的 locator
  → 可以传给同一 Domain 的 execute
```

Domain 负责：

- locator schema；
- locator 验证；
- locator 失效处理；
- locator 与文档模型的映射。

不同 Domain 可以有完全不同的 locator：

```ts
// office
{ type: 'sheet-cell', sheet: 'Q1', range: 'B2' }

// email
{ type: 'thread', threadId: '...' }

// docs
{ type: 'paragraph', blockId: 'p-17' }
```

### 6.4 无 locator 的命中

如果 Domain 暂时无法提供可执行 locator：

```ts
{
  domain: 'pdf',
  ref: 'file:///.../scan.pdf',
  snippet: '...',
  actionable: false,
}
```

规则：

- `actionable: false` 不能直接 `execute`；
- 只能作为阅读线索；
- Domain 可以提供显式的 `locate` / `open` 操作，把只读线索转成 locator。

## 七、Domain 内部的资源组织

Business Domain 可以有自己的内部实现，但对外只暴露工具接口：

```text
Business Domain（plugin）
├─ tools
│   ├─ read / ls / find / search / execute
├─ frontend
│   └─ page / settings
├─ search index
│   ├─ Markdown cache
│   └─ locator index
└─ engine
    ├─ codec / parser
    ├─ document model
    └─ native operations
```

- codec / transport 不再是独立的上层概念；它们是 Domain 内部实现细节。
- Domain 可以包装 CLI、Python 脚本、原生库或 WASM 引擎。
- Domain 安装/卸载时，自己的索引、缓存、前端页面和操作一起失效。
- 没有全局 Resource Map；只有各 Domain 的 catalog 与索引。

## 八、当前实现与差距

当前实现已经具备：

- DomainRegistry / Dispatcher，DomainModule 依赖拓扑序；
- workspace / shell / settings / agent 四个 DomainModule；
- workspaces / resources / lists / plugins / shell / settings，以及 sessions / models / skills / thinking / extensions / tools / prompts / themes 等 domain；
- workspace-scoped resource 以 `ws:<wsId>` 作为路径条件；
- URA 的 transport / codec / pipeline / page session / 资源地图；
- Agent tools、插件安装、设置页、传统 UI。

但当前仍然以 URA 为中心：

| 主题     | 当前实现                                                | 目标                            |
| -------- | ------------------------------------------------------- | ------------------------------- |
| 统一入口 | URA facade + Domain 命令双入口                          | DomainRegistry 统一 dispatch    |
| 插件     | codec / transport / presenter / sidecar / list 混合 SDK | Business Domain tools           |
| 资源发现 | L1 目录树 + L2 Markdown + URA                           | Domain catalog + Domain search  |
| 搜索     | 资源地图 / grep / describe                              | Domain.search，带 locator       |
| Locator  | URA/资源页面承担                                        | Domain 泛型 locator             |
| 操作     | 核心工具 + 部分 Office 工具                             | `execute(op, target, input)`    |
| UI       | 传统 UI 走 resources / lists / plugins domain           | UI 与 Agent 共用 DomainCommand  |
| Sidecar  | URA 资源地图                                            | Domain 自有 Markdown 缓存与索引 |
| 命令扩展 | 每类操作新增 API                                        | 新增 Domain op / descriptor     |

## 九、需要坚守的规则

- **没有 URA / Domain Gateway 独立层**：统一入口由 DomainRegistry.dispatch 承担。
- **插件就是 Business Domain**：插件负责资源、搜索、操作和前端。
- **System / Business 分离**：窗口、视图、provider、session 不塞进业务插件。
- **搜索必须带 locator**：没有 locator 的命中只能阅读，不能直接执行。
- **Locator 归 Domain**：DomainRegistry 只透传，泛型类型由插件定义。
- **命令统一**：UI、Agent、Skills 都走 `DomainCommand`。
- **不做每命令一个 tool**：工具面稳定为 read / ls / find / search / execute，具体操作由 describe 发现。
- **Domain 自有缓存**：Markdown 缓存、搜索索引、locator 索引归 Domain 生命周期管理。
- **不暴露裸 shell**：Domain 可以内部包装 bash/CLI，但 Agent 只看到 Domain 命令。
- **写操作收口**：所有变更都走 Domain.execute，不做旁路写入。

## 十、收敛顺序

1. **定义 DomainRegistry 契约**：DomainManifest、DomainCommand、OperationDescriptor、泛型 Locator。
2. **拆分 System / Business Domain**：先让 windows / views / sessions / settings 不进入业务工具面。
3. **把插件升级为 Business Domain**：插件清单增加 tools、search、locator、frontend。
4. **把资源发现收进 Domain**：取消 L1 树；Domain.search 返回 ref + locator。
5. **把现有 URA 资源能力迁入 Office/Docs Domain**：codec、页面会话、Markdown 缓存、索引。
6. **统一 Agent 工具面**：read / ls / find / search / execute，全部带 domain。
7. **统一 UI 命令**：命令面板、按钮、插件前端都走 DomainRegistry.dispatch。
8. **迁移技能**：技能从“描述资源地图”改为“选择 Domain + 操作工作流”。
9. **验收**：搜索结果必须可执行；UI/Agent 同一命令；Domain 卸载后索引/页面/命令全部失效。

## 十一、待确认

- 全局搜索是否由 DomainRegistry fan-out 到所有 Business Domain，还是由 Skill 先选 Domain？
- System Domain 是否需要暴露给 Agent，还是只允许 UI 调用？
- Domain 的 frontend 是否只能访问本 Domain 的命令，还是允许跨 Domain 只读？
- Locator schema 是否需要跨进程序列化版本号？
- Business Domain 的搜索索引放在 Domain 私有目录，还是工作区共享缓存目录？
- 一个插件是否可以注册多个 Business Domain（例如 office-docs / office-sheets）？
