# 目标架构：两入口一命令表

> 本文描述 WorkStudio 的目标架构，并对照当前实现。界面分业务 UI 与助手 UI 两个入口，各自经过 IPCDispatcher 到达不同目标：业务 UI 直达 DomainRegistry，助手 UI 直达 AgentHarness。DomainRegistry 把域分为 System 与 Biz 两类，Biz Domain 是插件后端；AgentHarness 的工具按插件实现取数而不是做文本操作，所有写操作经 bash 执行 CLI 命令。两条入口最后汇合在同一张命令表上。当前稳定实现见 [架构设计](./architecture.md)。

图示：[目标架构图](./architectrue.excalidraw)（六块：总览 · 插件实现层 · locator · 工具 · System Domain · 页面地址与 scheme）。

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
       → URA runtime                        → Harness（资源工具 / office_gen）
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

| 部分     | 现状                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| 入口     | 助手页与业务页共用同一条 workStudio 桥，全部落到 DomainRegistry              |
| 路由     | IPCDispatcher 只按 sender 判 origin，不区分页面目标                          |
| 会话     | sessions / models / skills / thinking 等作为 domain 挂在 DomainRegistry 下   |
| 工具     | 手写的资源工具（read / write / edit / grep / find / ls / query）+ office_gen |
| 资源发现 | 侧栏列表 + 列表注册表；资源地图从列表生成 `AGENTS.md` 注入 context           |
| 插件     | 插件 SDK 注册 transport / codec / presenter / sidecar / list / view action   |
| 操作     | 读走资源门面，写走 write / edit 工具；Office 生成走独立工具                  |

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
  → ResourcesService → URA runtime
      → PluginHost / UraRegistry / ResourcePipeline / PageSessions / ResourceMap
```

### 1.3 结构轴已落地

| 目标条目                           | 现状                                           |
| ---------------------------------- | ---------------------------------------------- |
| 主进程分层                         | Runtime / Domains / Agent Layer 已按职责分离   |
| DomainModule 依赖拓扑序            | 声明 `dependencies`，拓扑 start、反向 stop     |
| 作用域：工作区是 scope 不是 domain | workspace-scoped 资源以 `ws:<wsId>` 寻址       |
| 视图 / 布局 / 场景归 System 侧     | shell 管理窗口、视图、布局、主题、对话框与通知 |

### 1.4 能力轴尚未落地

| 核心判断             | 状态   | 说明                                                |
| -------------------- | ------ | --------------------------------------------------- |
| 两个入口分离         | 未落地 | 助手页与业务页共用一条通道，最终都进 DomainRegistry |
| Harness 独立成层     | 部分   | 有 Agent Layer，但会话与配置仍作为 domain 暴露      |
| 工具由插件实现       | 未落地 | 工具是手写的资源门面封装，与插件注册面分开维护      |
| ls / find 由地图服务 | 未落地 | 地图是注入 context 的清单文件，检索靠遍历           |
| 写操作只有 bash      | 未落地 | 有 write / edit 工具；无命令通道                    |
| locator 闭环         | 未落地 | 编辑用字节区间，读取结果不携带可复用的 locator      |
| 命令表统一           | 未落地 | 页面命令、工具、插件注册面各自一套                  |

## 二、目标分层

### 2.1 五层

| 层  | 职责                                                         | 不负责               |
| --- | ------------------------------------------------------------ | -------------------- |
| 1   | Renderer：业务 UI 与助手 UI 两个入口，全部走 preload 桥      | 状态、路由、能力     |
| 2   | IPCDispatcher：origin → 通道判断、订阅归属、请求日志         | 业务逻辑、工具、授权 |
| 3   | DomainRegistry 与 AgentHarness：两个并列模块，各占一条通道   | 引擎实现、数据存储   |
| 4   | 插件实现层：Domain 通讯封装 · skills 封装 · 引擎，统一在这里 | 路由、GUI、会话      |
| 5   | 数据层：结构（目录树 / ref）与外部来源；派生内容归引擎       | 协议、命令语义       |

```text
Layer 1 Renderer
  业务 UI：shell / settings / welcome / overlay / 插件页
  助手 UI：assistant
        │ business                    │ assistant
        ▼                             ▼
Layer 2 IPCDispatcher
        │                             │
        ▼                             ▼
Layer 3 ┌ DomainRegistry ──────┐  ┌ AgentHarness ──────────┐
        │ System Domain        │  │ context（依赖 L5 结构） │
        │ 命令表 → Biz 封装标准 │  │ tools：ls/find · read  │
        │                      │  │        grep · bash     │
        └──────────┬───────────┘  └──────────┬─────────────┘
                   │                          │
                   └────────────┬─────────────┘
                                ▼
Layer 4 插件实现层：Domain 通讯封装 · skills 封装 · 引擎
                                ▼
Layer 5 数据层：结构（目录树 / ref）· 外部来源
```

- **Layer 1** 只有两个入口：业务 UI 与助手 UI。两者都通过 preload bridge 通讯，页面不持 Node，不触 Electron。
- **Layer 2** 只做路由与归属：按页面判断通道，业务通道交给 Registry，助手通道交给 Harness。
- **Layer 3** 是两个并列模块：Registry 在前，给出 System Domain 与 Biz Domain 的封装标准；Harness 在右，独占助手通道。
- **Layer 4** 是插件实现层：上方是 `Domain 通讯接口封装` 与 `skills 封装`，下方是引擎；统一在这一层完成。
- **两个封装**：Domain 把引擎的命令描述编译成类型化 op；skills 把它写成命令手册，由 bash 按需消费。
- **Layer 5** 是数据层：结构（目录树、ref）供 `ls` / `find` 与 context 使用；引擎读写来源，派生内容留在插件实现层的引擎里。

### 2.2 两个入口

| 入口    | 页面                                          | 目标           | 通道内容                         |
| ------- | --------------------------------------------- | -------------- | -------------------------------- |
| 业务 UI | shell / settings / welcome / overlay / 插件页 | DomainRegistry | 命令 invoke、状态订阅、页面会话  |
| 助手 UI | assistant                                     | AgentHarness   | 会话、消息、任务、模型与技能选择 |

- 业务 UI 不直接触达 Harness；它需要的模型、技能、扩展清单由 Harness 以**只读投影**登记到 Registry 的 `agent` 命名空间。
- 助手 UI 不直接触达业务域；它对资料的全部操作都经过工具层，工具层再经命令表落到 Biz Domain。

### 2.3 两条通道

```text
业务通道
  invoke(command)     → DomainRegistry.invoke(origin, command)
  subscribe(address)  → DomainRegistry 状态投影
  page(op)            → 页面会话（System Domain）

助手通道
  session(op)         → AgentHarness 会话控制
  subscribe(address)  → 会话投影（消息 / 流式 / 任务）
```

两条通道共用一个 preload 桥，由 Dispatcher 按页面通道名分流；不接受页面自行指定目标。

助手会话的投影（消息、流式、任务）由 Harness 直接推送；设置页需要看的模型、技能、扩展清单是 Harness 登记到 Registry `agent` 命名空间的只读投影。两边不共享命令。

## 三、AgentHarness

### 3.1 三块职责

| 块      | 内容                           | 数据来源                           |
| ------- | ------------------------------ | ---------------------------------- |
| context | 资源地图、系统提示、会话历史   | 资源地图索引、会话文件             |
| skills  | 按需加载的工作流说明           | 技能目录（名称 + 描述先入 prompt） |
| tools   | read / ls / find / grep / bash | 地图索引、Biz Domain、CLI 命令     |

### 3.2 工具面

工具不是文本操作，而是**按插件实现取数**：

| 工具   | 取数路径               | 是否触达插件 | 返回                                |
| ------ | ---------------------- | ------------ | ----------------------------------- |
| `ls`   | 资源地图索引           | 否           | 目录下的条目（ref · domain · mime） |
| `find` | 资源地图索引           | 否           | 匹配的路径与 ref                    |
| `read` | Biz Domain 的 `read`   | 是           | 内容 + `locator`                    |
| `grep` | Biz Domain 的 `grep`   | 是           | 命中（ref · 摘要 · `locator`）      |
| `bash` | skills 封装 → 引擎 CLI | 经插件实现层 | stdout / exitCode                   |

- `ls` / `find` 不发插件请求：它们查内存中的资源地图索引，因此是零延迟、跨域的。
- `read` / `grep` 直接分发到插件实现方法；**返回值必须携带 locator**，供下一步写入使用。
- 不提供 `write` / `edit` / `grep`(ripgrep) 三件文本工具：写与改一律经由 `bash` 执行 CLI 命令。
- 工具名与插件实现解耦：同一套工具名覆盖所有 Biz Domain，域由 `ref` 或 `--domain` 决定。

### 3.3 资源地图

资源地图是**目录结构**，进入系统上下文；它同时是 `ls` / `find` 的索引。

以下为索引形态；进入 context 的只有目录骨架与类型统计：

```text
workspace
├─ 销售/                       (dir · files)
│  ├─ 2026Q1.xlsx              (doc · office · xlsx)
│  └─ notes.md                 (doc · markdown)
├─ 交付/                       (dir · files)
└─ mail/                       (dir · email，合成挂载)
   └─ 2026-03-18 客户回执      (thread · email)
```

- 每个 Biz Domain 通过 `mount()` 贡献子树：文件域贡献真实目录，其他域贡献合成挂载点。
- 进入 context 的是**目录结构 + 条目归类**，不是全量文件清单；单个目录内的文件由 `ls` 按需展开。
- 上下文里以命名 section 注入，索引变化时整段替换，不改写历史消息。
- 索引与 context 投影分离：索引全量驻留主进程，context 只投影目录骨架。

### 3.4 locator 闭环

```text
read / grep  →  { content | hits[], locator }
                     │
                     ▼
bash  ws edit <ref> --at <locator> --stdin
                     │
                     ▼
              Biz Domain.execute
```

- `locator` 是**短字符串 token**，不是 JSON：可直接放进命令行参数，不需要转义。
- 形式为 `<domain>:<type>:<id>[~<baseline>]`，例如 `office:cell:Q1!B2~v7`、`docs:para:p-17~sha1:3f9a`。
- 携带基线：内容变化后 locator 失效，命令返回 `stale`，不静默错位。
- 同一 Domain 内自洽：`read` / `grep` 产出的 locator 一定能被该域命令消费；跨域不通用。

### 3.5 写操作只有 bash

| 操作        | 路径                                         |
| ----------- | -------------------------------------------- |
| 创建 / 覆盖 | `ws write <ref> --stdin`                     |
| 局部替换    | `ws edit <ref> --at <locator> --stdin`       |
| 结构化修改  | `ws <domain> <op> <ref> [flags]`             |
| 生成 Office | `ws office create <ref> --kind xlsx --stdin` |

- 内容一律经标准输入传递，不放在参数里：避免引号、换行与长度问题。
- 写命令内部走同一套校验、写队列与危险确认，与业务 UI 的 invoke 完全一致。
- 不再有独立的 write / edit 工具；它们退化为 `files` 域的两个命令。
- **bash 依赖按需加载的 skills**：工具本身不含命令用法；Agent 先加载对应技能，才知道该调哪些命令、以什么顺序组合。没有技能命中时，Agent 只剩发现类工具可用。

### 3.6 skills 渐进披露

- 启动时只有技能的**名称、描述、路径**进入系统提示；正文在任务匹配时才读取。
- 每个 Biz Domain 提供一到多个技能，内容只写工作流，不写参数手册：

```text
1. 用 read / grep 取到目标与 locator；
2. 用 ls / find 确认路径；
3. 用 ws <domain> <op> --at <locator> 执行修改；
4. 用 read 复核结果。
```

- 参数细节由 `ws <domain> <op> --help` 生成，skill 不复述，避免与代码漂移。
- 技能正文与命令手册来自**引擎的同一份命令描述**：域封装把它编译成类型化 op，技能把它写成工作流手册，两份产物不会各写一套。
- 技能不再描述资源清单：地图由 context 提供，技能只描述过程。

## 四、DomainRegistry

### 4.1 两类 Domain

| 类型          | 例子                                                          | 职责                             | 工具面 |
| ------------- | ------------------------------------------------------------- | -------------------------------- | ------ |
| System Domain | windows / views / pages / settings / theme / layout / dialogs | 应用运行时、窗口、视图、状态管理 | 不进   |
| Biz Domain    | files / office / docs / sheets / email                        | 业务资源、业务检索、业务命令     | 进入   |

- Registry 给出两类封装标准：System Domain 是「命令 + 投影」，Biz Domain 是「mount / read / grep / execute + schema / locator」。
- System Domain 只暴露命令与状态投影，供业务 UI 使用。
- Biz Domain 分两层：**域封装**（类型化 op、命令表、授权、失效传播）依赖**引擎**（OOXML / PDF / Markdown 解析、文档模型、Markdown 缓存、locator 索引、CLI）。
- 引擎只提供能力与命令描述，不感知 GUI、Agent 与 IPC；域封装与 skills 是它的两个集成。
- 会话、模型、技能、扩展归 AgentHarness，不再是 Domain。

### 4.2 命令表

命令表是唯一真相，两个入口都是它的投递：

```ts
interface DomainManifest {
  id: string;
  type: 'system' | 'business';
  label: string;
  description?: string;
  scope?: 'app' | 'workspace';
}

interface CommandDecl {
  name: string; // 域内唯一：read / edit / slide.add
  summary: string;
  /** 位置参数与选项；两者共同构成 argv 形态 */
  args?: ArgSpec[];
  options?: Record<string, OptSpec>;
  /** JSON 形态；省略时由 args / options 推导 */
  input?: TSchema;
  output?: TSchema;
  /** 接受标准输入（内容类命令） */
  stdin?: boolean;
  mutates?: boolean;
  danger?: 'safe' | 'confirm' | 'destructive';
  /** 成功后需要刷新哪些投影 */
  invalidates?: readonly string[];
  /** 允许从哪些入口调用 */
  exposure?: ReadonlyArray<'tool' | 'cli' | 'ui'>;
}

interface DomainRequest {
  domain: string;
  op: string;
  ref?: string;
  /** locator token */
  target?: string;
  input?: unknown;
}
```

同一份声明同时给出两种形态：

```text
ws office edit deck.pptx --at office:shape:s-3 --stdin < content.json
     ⇕
{ domain: 'office', op: 'edit',
  ref: 'file:///…/deck.pptx',
  target: 'office:shape:s-3',
  input: { content } }
```

### 4.3 三个访问面

| 面     | 入口                  | 形态             | 消费者                      |
| ------ | --------------------- | ---------------- | --------------------------- |
| 工具面 | Registry 的方法调用   | 结构化 + locator | AgentHarness 的 read / grep |
| 命令面 | `invoke` 或 `ws` argv | 结构化 / argv    | 业务 UI、bash、skill        |
| 投影面 | `subscribe`           | snapshot / patch | 业务 UI 与插件页            |

工具面只有 `read` / `grep` 两条命令，声明为 `exposure: ['tool']`：`ls` / `find` 由地图索引承担，写操作归命令面。

### 4.4 invoke

```text
1. origin → 通道与权限       业务 UI / 插件页 / CLI / service
2. 查找命令声明              未注册 → denied
3. 校验参数与 locator        argv 与 JSON 归一后同一套 schema
4. 执行环境装配              signal · stdin · stdin 上限 · 进度
5. 执行                       写命令按 (domain, ref) 串行
6. 失效传播                  publish(invalidates) · 重建地图条目
7. 结果归一                  结构化结果 + stdout + 退出码
8. 记录                      origin · domain · op · 耗时 · 退出码
```

| 退出码 | 含义         |
| ------ | ------------ |
| 0      | 成功         |
| 1      | 执行失败     |
| 2      | 用法错误     |
| 3      | 拒绝         |
| 4      | locator 失效 |

### 4.5 状态投影

- 业务 UI 的状态一律是投影：订阅 `(domain, resource)` 拿 snapshot，变更收 patch / event。
- 页面会话（打开、保存、重读、脏态）是 System Domain 的投影，不是业务命令。
- Biz Domain 的投影只用于目录、任务与索引状态；资料内容不经投影传输。

## 五、两入口汇合

### 5.1 bash → 引擎 CLI

```text
业务路径  GUI invoke → DomainRegistry.invoke → Biz 域封装 ─┐
                                                           ├─→ Engine 执行（同一份命令实现）
助手路径  bash → ws（引擎 CLI）─────────────────────────────┘
```

- `ws` 是引擎的 CLI 入口；它的命令与域封装来自同一份命令描述。
- 两条路径在**引擎实现**处汇合，不存在第二套写实现。
- GUI 路径额外获得授权、写队列与失效传播；Agent 路径只拿 stdout 与退出码，基线校验与写队列由引擎执行。
- 助手侧不需要知道 IPC 的存在：它只看到命令与退出码。

### 5.2 shell 环境

- `bash` 是真实 shell；Windows 上替换为 powershell，命令语义一致。
- 启动时在 PATH 前注入一个只含 `ws` 的目录：域写入的唯一入口是它，且不会被同名命令遮蔽。
- 系统 PATH 照常保留，`head` / `tail` / `wc` / `ls` 这类只读命令用于查看与过滤，不写工作区。
- 环境变量暴露工作区与会话身份，供 `ws` 解析默认作用域。

### 5.3 一致性与外部变更

bash 的自由度意味着无法阻止绕过 `ws` 的写入。架构靠**观察**而不是禁止来保持一致：

| 情况                 | 处理                                       |
| -------------------- | ------------------------------------------ |
| 经 `ws` 写入         | 事务语义；写队列；locator 基线推进         |
| 绕过 `ws` 的外部写入 | 文件监听捕获 → 索引重建 → 页面标记外部变更 |
| locator 基线失效     | 命令返回 `stale`，要求重新读取             |
| 索引与磁盘不一致     | 以磁盘为准重建，投影随后刷新               |

### 5.4 一次编辑的完整路径

```text
assistant
  → grep { query: '华东', scope: '销售/' }
  → hits [{ ref, snippet, locator: 'office:cell:Q1!B2~v7' }]
  → bash: ws office edit 销售/2026Q1.xlsx --at office:cell:Q1!B2~v7 --stdin
        └─ stdin: { value: 1200 }
  → ws 解析 argv → 引擎执行 edit（命令描述来自域封装）
  → 引擎校验 locator 基线 → 写入 → 返回新版本与新 locator
  → 索引失效 → 地图条目更新 → 打开该文件的页面收到外部变更提示
```

业务 UI 里对同一单元格的修改与这条路径完全重合，只是入口从 bash 换成 `invoke`。

## 六、插件实现层

### 6.1 清单

```ts
interface PluginManifest {
  id: string;
  label: string;
  description?: string;
  /** 插件后端提供的业务域 */
  domain: DomainManifest;
  /** 前端出口 */
  page?: string;
  settings?: string;
  /** 提供的技能 */
  skills?: string[];
}
```

### 6.2 声明面

```ts
interface BizPlugin {
  manifest: PluginManifest;

  /** 资源地图：贡献子树 */
  mount(ctx: DomainScope): Promise<MountNode[]>;

  /** 工具面：读取与检索，返回值必须带 locator */
  read(
    input: {
      ref: string;
      target?: string;
      detail?: 'summary' | 'full';
    },
    ctx: OpContext,
  ): Promise<{ content: string; locator?: string }>;

  grep(
    input: {
      query: string;
      scope?: string;
      limit?: number;
    },
    ctx: OpContext,
  ): Promise<Array<{ ref: string; snippet: string; locator: string }>>;

  /** 命令面：写与结构化操作 */
  commands: CommandDecl[];
  execute(
    command: string,
    args: CommandArgs,
    ctx: OpContext,
  ): Promise<CommandResult>;

  start?(ctx: DomainScope): void | Promise<void>;
  stop?(): void | Promise<void>;
}

interface CommandResult {
  stdout?: string;
  data?: unknown;
  exitCode?: number;
}
```

- `read` / `grep` 是工具面上两条命令的实现，返回结构化结果与 locator。
- `execute` 是命令面，接收已解析的 argv / JSON，返回 stdout + 数据 + 退出码。
- 两份实现共用同一张命令表：`read` / `grep` 在表里以 `exposure: ['tool']` 出现，其余命令以 `['cli', 'ui']` 出现。
- 引擎不是 SDK 面：插件自带引擎（原生库 / 脚本 / CLI），域封装只消费它的命令描述与文档模型；skills 封装消费同一份描述生成手册。
- 两者共用同一个域实例与同一份索引，插件不必维护两套状态。
- 不要求实现路径原语：插件不提供 `readFile` 之类的文件接口，也不接触绝对路径。

### 6.3 前端出口

- `page`：文档查看器，由资源打开流程装载，带文档内容与页面会话。
- `settings`：配置页，只处理本域设置。
- 插件页与业务 UI 走同一条通道；页面只能执行本域命令，跨域只读需在清单声明。

### 6.4 生命周期

- 装载：注册域 → 贡献地图子树 → 登记命令 → 技能进入目录。
- 卸载：撤销命令、移除子树、删除索引与缓存、关闭已打开页面。
- 工作区切换：域实例随工作区重建，地图与索引重新装载；App 级目录清单不变。

### 6.5 地址栏展示

地址栏显示的是**地址的投影**，不是加载地址本身；两者都不出现系统绝对路径。

| 页面        | 内部地址                                     | 地址栏显示                           |
| ----------- | -------------------------------------------- | ------------------------------------ |
| 内置设置    | `work://studio/settings/appearance`          | 设置 · 外观                          |
| 插件设置    | `plugin://markdown-viewer/settings`          | Markdown 阅读器 · 设置               |
| 文档 / 表格 | `plugin://office/content?ref=file:///…`      | `销售/2026Q1.xlsx`（工作区相对路径） |
| 网页        | `https://example.com/pricing`                | `example.com/pricing`                |
| 邮件        | `plugin://mail/content?ref=mail://work/t-42` | 邮件 · 客户回执                      |

- `host` 提供名称：插件名来自清单 `label`，内置页名称来自页面注册表。
- `ref` 提供内容标识：本地文件取工作区相对路径，网页取域名与路径，邮件取账号与线程标识。
- 展示与 scheme 注册无关：注册只决定能否加载，展示由 host 与 ref 映射得到。

## 七、当前实现与差距

### 7.1 已经具备

- DomainRegistry / Dispatcher 与 DomainModule 依赖拓扑序；
- workspace / shell / settings / agent 四个生命周期模块；
- workspace-scoped 资源以 `ws:<wsId>` 作为路径条件；
- 资源管道（transport / codec / pipeline / page session）与资源地图；
- Agent 工具、插件安装、设置页与传统 UI。

### 7.2 差距表

| 主题 | 当前实现                           | 目标                           |
| ---- | ---------------------------------- | ------------------------------ |
| 入口 | 单入口，全部进 Registry            | 业务 / 助手两条通道            |
| 会话 | sessions 等作为 domain             | 归 AgentHarness                |
| 工具 | 手写资源工具 + office_gen          | read / ls / find / grep / bash |
| 发现 | 全量清单文件                       | 目录结构地图 + 索引            |
| 读取 | 门面返回 presentation              | 插件方法返回内容 + locator     |
| 写入 | write / edit 工具                  | bash → ws → invoke             |
| 命令 | 每类操作新增页面命令与工具         | 命令表新增一条声明             |
| 插件 | codec / presenter / sidecar / list | mount / read / grep / commands |

### 7.3 现有能力去向

| 现有概念      | 去向                   | 处理                                   |
| ------------- | ---------------------- | -------------------------------------- |
| transport     | 共享内核               | 保留为注入依赖，不再按 scheme 全局抢注 |
| codec         | Biz Domain 私有 engine | 不再注册；域内按 MIME 选择             |
| presenter     | 插件前端出口           | 由清单声明页面                         |
| sidecar       | `read` 的投影          | 变成 `detail` 参数                     |
| store / query | 命令                   | 变成域命名空间命令                     |
| binding       | 域设置                 | 从全局绑定表降到域作用域               |
| view action   | 插件前端               | 随插件卸载                             |
| list provider | 资源地图的子树         | 侧栏是地图的投影                       |
| 资源地图文件  | 删除                   | 索引驻留主进程，context 只放目录骨架   |
| 页面会话      | System Domain pages    | 从资源域拆出，不进工具面               |

## 八、需要坚守的规则

- **两个入口**：业务 UI 只到 Registry，助手 UI 只到 Harness；不互相穿透。
- **System / Biz 分离**：运行时域不进工具面；业务域不管理窗口与视图。
- **工具按插件取数**：`read` / `grep` 落到插件实现，不做文本兜底。
- **ls / find 只读索引**：两种工具不触发插件调用，保证发现成本恒定。
- **locator 必须闭环**：读取结果没有 locator 就只能阅读，不能写。
- **写操作只有 bash**：没有独立的 write / edit 工具，内容经 stdin。
- **命令描述唯一**：域封装、CLI 命令、skills 手册来自引擎的同一份声明。
- **argv 与 JSON 同构**：一种能力两种形态，校验、授权与日志只有一份。
- **插件不接触路径**：插件只认 ref 与 locator，路径解析归内核。
- **变更一致性靠观察**：绕过 `ws` 的写入不被阻止，但会被索引与页面识别。
- **不暴露裸 shell 给插件**：插件可以包装 CLI，Agent 只看到域命令。
- **引擎统一出命令**：域封装与 skills 是同一份命令描述的两个集成，不各自维护命令清单。
- **bash 依赖 skills**：写与改的命令用法来自按需加载的技能，不在工具里内置业务知识。

## 九、收敛顺序

每个里程碑独立可验收；代码改动按 `pnpm verify` 收口，UI / 交互改动按 `dev_test` 与隔离 e2e 收口。

| 里程碑 | 内容                                                                                             | 完成定义                                                  |
| ------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| M0     | 冻结契约：清单、命令声明、请求、locator、插件接口                                                | 类型落地，`pnpm verify` 通过，运行时行为不变              |
| M1     | 命令表与 `invoke`：argv ⇄ JSON 同构、退出码、写队列、失效传播                                    | 现有命令迁移到命令表，行为不变；e2e 全量通过              |
| M2     | `ws` 与 bash：PATH 注入、stdin、`--help`、`--at`、退出码                                         | bash 能完成一次创建与一次 locator 编辑；日志与 UI 同源    |
| M3     | 资源地图索引：目录骨架进 context，`ls` / `find` 查索引                                           | 目录树与磁盘一致；`ls` / `find` 不触发插件调用            |
| M4     | 工具面重定义：`read` / `grep` 落到 Biz Domain，返回 locator；删除 write / edit 工具              | 读取携带 locator；写入全部经 bash；手写工具删除           |
| M5     | 入口拆分：助手通道直达 Harness，会话从 Registry 移出                                             | 助手页不再调用业务域命令；设置页经只读投影取 Harness 数据 |
| M6     | 插件升级：清单声明域、mount、read / grep、commands；三个内置插件迁移                             | 卸载插件后命令、子树、索引、页面同时失效                  |
| M7     | Office 域：引擎层（OOXML 解析、文档模型、Markdown 缓存、locator 索引）+ 域封装；生成脚本收进引擎 | docx / xlsx / pptx 可读可搜可改；生成走 `office create`   |

顺序理由：先命令表与 bash 通道，再地图索引与工具面，最后动入口与插件。反过来会得到两套并行的调用路径。

## 十、待确认

- `bash` 的 PATH 是否只保留 `ws` 与少量只读过滤器，还是保留完整系统命令？
- 资源地图的目录骨架是否包含文件名（更省一次 `ls`，但 context 更大），还是只放目录与类型统计？
- 助手通道的投影是否也由 Harness 自己推送，还是统一登记到 Registry 的 `agent` 命名空间？
- 插件是否允许贡献多个挂载点（例如一个插件同时挂 `docs/` 与 `templates/`）？
