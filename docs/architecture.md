# 架构设计

> WorkStudio 是以文件为中心的桌面工作台。框架持有状态、授权与通讯；插件提供专用能力；业务 UI 与助手是同一套能力的两个入口。

## 一、总体设计

### 1.1 分层

| 层             | 职责                                             | 不负责                  |
| -------------- | ------------------------------------------------ | ----------------------- |
| 渲染层         | 系统页与内容页：只消费投影、发送意图             | 权威状态、进程能力      |
| preload bridge | 页面唯一出口：`subscribe` / `command` / `notify` | 业务语义、目标指定      |
| IPC 与分发     | origin 判定、路由、日志、订阅归属                | 业务逻辑、授权、locator |
| 三个模块       | DomainRegistry / AgentHarness / Browser          | 具体业务实现            |
| 插件实现层     | 引擎与页面：数据接口、命令实现、内容页与设置页   | 状态、授权、分发        |
| 数据层         | 工作区文件、网页缓存、外部来源                   | 解释、呈现、变更订阅    |

三个模块并列，边界由各自的输入决定：

- **DomainRegistry** 面向业务：System / Biz 两类 Domain 的注册、命令表、分发与订阅。
- **AgentHarness** 面向会话：模型、上下文、技能与工具面，工具最终都落到前两层的接口上。
- **Browser** 面向网页：导航策略、自动化、采集与快照，并持有 web 域。

### 1.2 总体结构

```text
┌─ 渲染层 ─────────────────────────────────────────────────────────┐
│ 系统页：shell · assistant · overlay · capture · welcome · settings │
│ 内容页：plugin://<id>/content · plugin://<id>/settings             │
│ 页面不持 Node / Electron，只有 window.workStudio                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │ subscribe / command / notify
┌─ preload bridge ──────────────▼──────────────────────────────────┐
│ 唯一出口；地址 = domain/resource；页面不能指定目标                  │
└───────────────────────────────┬──────────────────────────────────┘
┌─ IPC 与分发 ──────────────────▼──────────────────────────────────┐
│ origin 判定 · 路由 · 订阅归属 · 请求日志                           │
└──────┬───────────────────┬──────────────────────┬────────────────┘
┌──────▼──────┐   ┌────────▼────────┐   ┌─────────▼───────────────┐
│ DomainRegistry │ │ AgentHarness    │   │ Browser                 │
│ System + Biz   │ │ context · tools │   │ policy · automation     │
│ 命令表 · 分发  │ │ skills · 会话   │   │ capture · web 域        │
└──────┬──────┘   └────────┬────────┘   └─────────┬───────────────┘
       └───────────────────┴──────────────────────┘
┌─ 插件实现层 ─────────────────────────────────────────────────────┐
│ 数据接口 ls / find / read / grep　命令实现 run　页面与设置         │
└───────────────────────────────┬──────────────────────────────────┘
┌─ 数据层 ──────────────────────▼──────────────────────────────────┐
│ 工作区文件 · 网页缓存 · 外部来源                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 插件与框架的边界

框架持有状态、授权、生命周期与数据管道；插件只提供能力。跨这条边界只有五处：

| 闸口 | 契约                                               | 方向         |
| ---- | -------------------------------------------------- | ------------ |
| 登记 | `definePlugin` 的导出                              | 插件 → 框架  |
| 命令 | 命令描述：参数、摘要、退出码                       | 插件 → 框架  |
| 技能 | 技能目录                                           | 插件 → 框架  |
| 页面 | `plugin://<id>/content` · `plugin://<id>/settings` | 框架 → 插件  |
| 数据 | `ref` 与 locator                                   | 双向，按契约 |

插件不实现 ls 与 find 之外的基础设施：不做状态、不做订阅、不做权限判断、不碰其它插件的资源。

### 1.4 关键决策

| 决策     | 选择                                   | 理由                                       |
| -------- | -------------------------------------- | ------------------------------------------ |
| 状态归属 | 主进程唯一真相源                       | 渲染层只持投影，避免人机两套状态           |
| 通讯     | 一个 bridge，三个动词                  | 页面只认地址，不认通道；校验与日志只有一处 |
| 能力归属 | 页面按 `plugin://` 装载                | 插件不进主进程视图树，页面生命周期由框架管 |
| 数据读取 | 域适配器提供 `ls`/`find`/`read`/`grep` | 只有域知道怎么枚举与解析自己的资源         |
| 写入     | 只有命令                               | 两条入口共用一份实现，写路径唯一           |
| 定位     | locator 只编码身份                     | 写入不改变身份，不需要版本比对与失效重读   |
| 变更     | 域发变更，订阅者刷新                   | UI 更新走通知，不靠轮询与重读比对          |
| 命令描述 | 一份声明生成四条通道                   | UI、CLI、手册、命令表不会漂移              |
| 插件装载 | 静态进清单，动态进 ESM 导出            | 扫描期不执行插件代码                       |
| 插件页面 | 类型由声明生成                         | 页面拿到类型与校验，不手写第二份接口       |

## 二、作用域与生命周期

### 2.1 作用域

| 作用域    | 内容                                                         |
| --------- | ------------------------------------------------------------ |
| App       | 模型目录、凭证、插件安装、全局设置、工作区列表、系统视图     |
| Workspace | 资源、列表、标签视图、布局现场、页面会话、会话记录、网页策略 |
| Session   | 模型上下文、消息、轮次、队列、技能激活                       |

切换语义：

- **工作区切换**：释放旧工作区 Resources / Sessions / 插件域实例，重绑新工作区；插件清单与页面注册不变。
- **会话切换**：切换模型运行时，事件重新绑定，页面订阅不重建。
- **插件热卸载**：撤销其域与命令、关闭其页面、清理订阅与缓存。

### 2.2 状态归属

| 状态                     | 作用域    | 真相源         |
| ------------------------ | --------- | -------------- |
| 窗口 / 主题 / 布局现场   | 进程      | 窗口与场景资源 |
| 工作区注册表与当前工作区 | App       | 工作区注册表   |
| 模型 / 凭证 / 全局设定   | App       | 设置存储       |
| 资源 / 列表 / 会话记录   | Workspace | 域持有         |
| 当前回复与任务           | Session   | 会话服务       |
| 设置页 / 更新 / 插件任务 | App       | 各自域持有     |

### 2.3 存储位置

| 内容         | 位置                 | 说明                             |
| ------------ | -------------------- | -------------------------------- |
| 用户设置     | 数据根               | 只写自己的命名空间，未知字段保留 |
| 模型与凭证   | 数据根               | 与环境变量隔离                   |
| 工作区自描述 | 工作区目录           | 随工作区移动                     |
| 布局现场     | 工作区目录           | 窗口重建后恢复                   |
| 会话记录     | 工作区目录下的会话区 | 追加写，不重写历史               |
| 网页快照     | 工作区目录下的站点区 | 保存后才是资源                   |
| 快照缓存     | 数据根下的缓存区     | 不进工作区，可随时丢弃           |
| 插件与技能   | App 数据目录         | 安装、卸载以目录为单位           |

### 2.4 插件的六个阶段

| 阶段       | 动作                                      | 失败后果       |
| ---------- | ----------------------------------------- | -------------- |
| install    | 解包、校验清单、写入安装目录              | 整体回滚       |
| resolve    | 校验路径与清单身份                        | 拒绝装载       |
| activate   | 载入 ESM 入口，注册资源、命令、技能、页面 | 撤销已注册部分 |
| ready      | 域可路由、命令入表、页面可开              | —              |
| deactivate | 撤销注册、关闭页面、清订阅                | 保持旧状态可用 |
| uninstall  | deactivate 后删目录、清设置与缓存         | —              |

插件在安装后统一激活；当前不提供按认领 / 命令 / 设置惰性激活，避免声明了却没有执行语义。

## 三、通讯

### 3.1 一个 bridge，三个动词

```ts
interface WorkStudioBridge {
  subscribe(domain: string, resource: string): Promise<unknown>;
  unsubscribe(domain: string, resource: string): void;
  command<T = unknown>(
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

| 动词          | 用途        | 语义                                                            |
| ------------- | ----------- | --------------------------------------------------------------- |
| `subscribe`   | 订阅        | 先返回快照，后续 `patch` / `event` 由 `onUpdate` 推送；返回快照 |
| `unsubscribe` | 取消订阅    | 按 `(domain, resource)` 释放订阅                                |
| `command`     | 请求 / 响应 | 返回 `CallResult`，错误带码                                     |
| `notify`      | 单向通知    | 不返回；失败只记日志                                            |
| `onUpdate`    | 推送        | 接收 snapshot / patch / event 帧                                |

页面只能发 `(domain, resource, action)`，不能指定目标：`origin` 由主进程按发送方判定，页面无法冒充其它视图。

### 3.2 地址空间

| 地址                     | 谁订阅   | 载荷                                             |
| ------------------------ | -------- | ------------------------------------------------ |
| `shell/view/<id>`        | 视图自身 | 内容、主题、动作、模式；视图上报加载、脏态、导航 |
| `workspace/<wsId>/<ref>` | 资源面板 | 快照、增量、变更事件                             |
| `shell/<resource>`       | 壳层     | 窗口、对话框、通知、布局                         |
| `<domain>/<resource>`    | 任意视图 | 由域决定                                         |

工具面和页面共用同一地址空间：助手 `read` 一个 `ref` 与页面 `subscribe` 同一个 `ref`，指向同一份数据。

### 3.3 三类例外

统一协议不覆盖三类通讯，它们各有物理通道：

| 场景                  | 通道               | 原因                             |
| --------------------- | ------------------ | -------------------------------- |
| 拖拽 / 缩放期间的指针 | 捕获层专用通道     | 每帧 60–120 次，需要先于业务消息 |
| 大二进制与流式输出    | 转移列表 / 分块流  | 一次传输与背压，不做逐条请求     |
| 进程内同步调用        | preload 内直接调用 | 不跨进程，进协议只会增加延迟     |

捕获层是拖拽期间的透明全窗视图：它把指针移动、抬起、取消报给主进程，主进程按屏幕光标计算布局预览；它没有业务状态，页面代码也不感知它。

### 3.4 失败语义

| 情形       | 返回                                        |
| ---------- | ------------------------------------------- |
| 地址不存在 | `{ ok: false, error: { code: 'unknown' } }` |
| 无权限     | `code: 'denied'`                            |
| 参数不合法 | `code: 'invalid'`                           |
| 目标不存在 | `code: 'not_found'`                         |
| 执行失败   | `code: 'failed'`                            |

命令行的退出码与上表一一对应：`0` 成功、`1` 失败、`2` 用法、`3` 未找到。

## 四、Domain、Registry 与分发

### 4.1 Domain 与 Resource

- **Domain** 是服务边界，按地址前缀区分，例如 `shell`、`workspace`、`agent`、`docx`。它像微服务一样拥有自己的资源、命令与不变量，不是“一个能力一个 Domain”。
- **Resource** 是 Domain 内可订阅、可寻址的聚合根或读模型，地址为 `<domain>/<resource>`。例如 `agent/skills`、`agent/<wsId>/sessions`、`shell/windows`。工作区作用域的资源必须带 `wsId`，例如 `workspace/<wsId>/list`、`agent/<wsId>/sessions`。
- **Command** 是唯一的操作单位，地址为 `<domain>/<resource>/<action>`。

聚合根决定一致性与事务边界：命令只修改聚合根，`snapshot` / `patch` 是它的投影；跨 Domain 只引用资源地址或注入端口，不直接拿对方的对象。这样 `agent` 不需要认识 `plugin` 的内部，`plugin` 也不需要认识会话。

Agent 运行时分三层：**AgentApp** 是 App 级共享服务（模型运行时、凭证、设置存储、技能、扩展工厂）；**AgentRuntimes** 以 `wsId` 为键管理各工作区的 **WorkspaceAgent**；每个 `WorkspaceAgent` 持有一个按 cwd 绑定的 pi `AgentSessionRuntime`。`agent/<wsId>/sessions` 首次使用时才创建对应 runtime，未创建时给只读投影；模型或凭证变更由 AgentApp 通知，统一重建各工作区会话。

`agent/prompts`、`agent/themes`、`agent/extensions` 是由 cwd 发现决定的 App 级投影，跟随当前工作区 runtime 的加载结果；工作区切换后由同一套资源重新投影，不单独按 wsId 拆分。

Resource 的三种消息：`snapshot`（首次全量）、`patch`（增量）、`event`（一次性事件）。

### 4.2 System Domain 划分

先按依赖关系收服务，再在每个服务内找聚合根：

```text
workspace ──→ shell
plugin ─────→ workspace
settings ───→ shell · workspace
browser ────→ shell · workspace
agent ──────→ workspace · plugin · browser
web ────────→ transport / cache（由 browser 模块承载）
```

箭头表示“依赖谁”，只表达启动顺序与调用方向；跨服务不注入对方对象，只通过资源地址、命令或端口。

| Domain（服务） | 聚合根 / 主要 resource                               | 读模型                                                                                                                                                                           |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`        | `windows` · `appearance`                             | `<wsId>/layout` · `<wsId>/views` · `<wsId>/view/<id>` · `<wsId>/dialogs` · `<wsId>/notices` · `pages` · `menu` · `interaction` · `native`                                        |
| `workspace`    | `registry`                                           | `<wsId>/list` · `<wsId>/search` · `<wsId>/<ref>`                                                                                                                                 |
| `plugin`       | `installed` · `task`                                 | `catalog`                                                                                                                                                                        |
| `settings`     | `preferences` · `updates`                            | `pages` · `storage`                                                                                                                                                              |
| `browser`      | `policy`                                             | `<wsId>/tabs` · `<wsId>/automation` · `<wsId>/capture`                                                                                                                           |
| `web`          | `web`（快照资源）                                    | —                                                                                                                                                                                |
| `agent`        | `skills` · `provider/<id>` · `model/<provider>/<id>` | `<wsId>/sessions`（`current` / `active` / `items` / `task` / `opened` / `thinking`） · `<wsId>/context` · `providers` · `models` · `tools` · `prompts` · `themes` · `extensions` |

聚合根是一致性边界：例如 `agent/skills` 管激活与禁用，`agent/<wsId>/sessions` 承载该工作区会话的命令与活跃会话投影（消息、轮次、队列、thinking）；`agent/provider/<id>` 管供应商配置与认证，`agent/model/<provider>/<id>` 管模型条目。`agent/tools`、`agent/prompts` 这类只读投影不承载命令，不强行做聚合根。`agent/<wsId>/sessions` 每个工作区一份：首次使用时按需创建该工作区的 pi runtime，未创建时给只读投影。模型、凭证、设置与技能是 App 级共享（AgentApp），会话与扩展上下文按工作区绑定。

System Domain 由模块持有，不读内容字节，也不出现在工具面里。模块只负责生命周期；Domain 才是服务边界，Resource 才是聚合根。例如 `skills` 是 `agent/skills`，不是独立的 `skills` Domain。

### 4.3 Biz Domain

Biz Domain 由插件持有，每个插件一个，地址前缀即插件标识。它必须提供：数据接口（`ls` / `find` / `read` / `grep`）与命令（`run`）。它可以没有页面，也可以只有设置页。

插件内容页通过 URL 拿到 `ref` 后，按工作区作用域订阅 `<domain>/<wsId>/<ref>`；`wsId` 由宿主注入到页面的 `workStudio.workspaceId`，插件页不自行推断当前工作区。

### 4.4 命令表

命令表是注册与分发的唯一依据。每条记录包含：所属域与资源、动作名、参数描述、摘要、退出码、实现归属。命令表同时被四个消费方使用：页面调用、命令行、助手手册、授权判断。

命令名冲突、资源重复认领、参数描述非法都会导致注册失败，不做静默覆盖。

### 4.5 分发

分发只做四件事：判定来源、查表、调用、记录。

| 输入            | 处理                              |
| --------------- | --------------------------------- |
| `origin` 不合法 | 拒绝，不进入域                    |
| 地址无对应条目  | 返回未知地址                      |
| 命中命令        | 调用实现，结果归约为 `CallResult` |
| 命中订阅        | 绑定订阅者，首次返回快照          |

分发不承载业务逻辑、不做授权判断、不解释 locator、不注入工具。

## 五、数据层与资源

### 5.1 数据层接口

域适配器提供四个读接口，框架只做路由：

```ts
interface ResourceAdapter {
  ls(ref: string, opts?: ListOptions): Promise<Entry[]>;
  find(ref: string, query: string): Promise<Entry[]>;
  read(ref: string, opts?: ReadOptions): Promise<Item[]>;
  grep(ref: string, query: string): Promise<Item[]>;
}
```

- `ls` / `find` 描述结构，`read` / `grep` 描述内容；只提供内容的域可以省略前两个，由框架按工作区路径枚举。
- `Entry` 描述结构：名称、类型、大小、修改时间、`ref`。
- `Item` 描述内容：至少带 `locator`，其余字段由域定义。
- 框架不校验 `Item` 的字段、不做统一文本化、不做分页切片；只限制条数并原样透传 `locator`。

枚举方式由域自己决定：文件系统按目录、压缩包按容器、邮件按账号。框架不持有目录状态，每次调用现枚举。

### 5.2 locator

locator 是**身份**，不是版本：

- 由读接口产出，形如 `docx:para:12`、`xlsx:cell:Q1!B2`；
- 写入不改变身份，因此不存在版本比对与失效重读；
- 目标不存在时返回 `not_found`，并附带所在容器，便于重新定位。

### 5.3 写路径

写入只有一条：命令。业务 UI 的写与助手的写走同一份实现，命令返回变更后的 locator（或受影响的范围）。

### 5.4 变更与 UI 刷新

```text
定位 → 命令 → 引擎写入同一份数据 → 域发变更 → 订阅者刷新
```

| 步骤 | 内容                                         |
| ---- | -------------------------------------------- |
| 定位 | locator 或工作区路径                         |
| 命令 | 页面 `invoke` 或助手 `bash`，同一实现        |
| 写入 | 域更新内存模型并落盘                         |
| 变更 | 域发出 `{ ref, kind: content \| structure }` |
| 刷新 | 内容页局部更新、资源面板重排、助手上下文失效 |

同一 `ref` 的所有订阅者收到同一条变更；没有二次读取，也没有基线校验。

### 5.5 web 域与快照

网页是唯一「来源地址与资源地址重合」的形态：

| 形态     | 地址                           | 归属           |
| -------- | ------------------------------ | -------------- |
| 实时网页 | `https://…`                    | 数据层外部来源 |
| 快照     | `work://studio/snapshot?url=…` | 只读投影       |
| 已保存   | 工作区站点目录下的文件         | 工作区资源     |

自动快照进缓存，保存后才是资源。快照引擎负责把 HTML 转成可读文本与标题结构。

## 六、命令与两条入口

### 6.1 命令描述

```ts
interface CommandDecl {
  summary: string;
  args: Record<string, ArgSpec>;
  run: (
    input: { ref: string } & Record<string, unknown>,
    ctx: PluginContext,
  ) => Promise<unknown>;
}

type ArgSpec =
  | {
      type: 'string' | 'number' | 'boolean';
      required?: boolean;
      default?: unknown;
    }
  | { type: 'locator'; scheme: string }
  | { enum: string[]; default?: string };
```

一份描述生成四条通道：

| 产物       | 消费方  | 形态                                 |
| ---------- | ------- | ------------------------------------ |
| 类型化操作 | 业务 UI | `invoke(domain, ref, action, input)` |
| 子命令     | 助手    | `ws <domain> <action> <ref> --at …`  |
| 命令手册   | 助手    | 由摘要与参数生成的表格               |
| 命令工具   | 助手    | `command` / `command_list`           |
| 命令表条目 | 分发    | 地址、参数、退出码                   |

### 6.2 两条序列化

| 入口 | 序列化     | 解析者 |
| ---- | ---------- | ------ |
| 页面 | JSON 对象  | 框架   |
| 助手 | 命令行参数 | 框架   |

插件只实现 `run`，不解析命令行：参数解析、必填校验、退出码归一由框架完成。静态描述由构建工具从同一份 `definePlugin` 命令表生成，不手写、不另维护；宿主激活时校验静态描述与动态实现对齐，再把地址登记进命令表。页面 IPC 与助手 `command` 工具因此共享同一个实现。

### 6.3 手册与技能

命令手册由命令描述生成，技能文档只补充工作流与判断，不重复参数说明。清单只列技能目录，名称 / 描述由 `SKILL.md` frontmatter 定义；插件技能默认只进入目录，不进入上下文，选中后才按需注入。

## 七、能力层

### 7.1 AgentHarness

三块职责：上下文（工作目录、打开的资源、当前选择）、工具面（取数与执行）、会话（模型、轮次、队列）。

### 7.2 工具面

| 工具           | 取数路径              | 约束                                  |
| -------------- | --------------------- | ------------------------------------- |
| `ls`           | 相邻 Biz 域的结构接口 | 只给结构与 `ref`，不给绝对路径        |
| `find`         | 同上，按条件过滤      | 结果有界                              |
| `read`         | 相邻 Biz 域的内容接口 | 返回条目列表，每条带 locator          |
| `grep`         | 同上，按查询匹配      | 默认跨域，带预算                      |
| `bash`         | 命令实现              | 命令行方式；退出码区分失败类型        |
| `command`      | 命令表                | 结构化输入调用同一命令地址            |
| `command_list` | 命令表                | 发现 domain / action / args           |
| 浏览器工具     | Browser 模块          | 仅在网页视图可用；产出交给 web 域缓存 |

没有 `write` 与 `edit`：写与改都走命令，这样两条入口共享同一实现与同一授权。

### 7.3 Browser 模块

| 资源       | 职责                               |
| ---------- | ---------------------------------- |
| browser    | 打开、导航、执行脚本               |
| policy     | 白名单、分区、导航加固             |
| automation | 调试协议、注入脚本                 |
| capture    | 采集 → 快照文档                    |
| web（Biz） | 网页资源的读、检索、保存与快照缓存 |

## 八、插件 SDK

### 8.1 静态声明

清单只描述「框架不执行插件代码就需要知道的事」：

```jsonc
{
  "type": "module",
  "exports": { "./workstudio": "./engine.js" },
  "workstudio": {
    "id": "docx",
    "label": "Word 文档",
    "icon": "file-text",
    "claims": [{ "extensions": ["docx"], "priority": 10 }],
    "pages": { "content": "page/index.html" },
    "settings": { "schema": "settings.schema.json" },
    "skills": ["skills/docx"],
  },
}
```

| 字段       | 语义                            | 必填       |
| ---------- | ------------------------------- | ---------- |
| `id`       | 域前缀与页面 host               | 是         |
| `claims`   | 认领哪些文件；冲突按优先级      | 否         |
| `domain`   | 命令地址前缀                    | 是         |
| `commands` | 命令描述构建产物位置            | 是         |
| `pages`    | 内容页；设置页可省              | 内容页必填 |
| `settings` | 设置 schema；有它则由宿主渲染   | 否         |
| `skills`   | 技能目录列表；元数据在 SKILL.md | 否         |

入口用标准 `exports` 子路径 `./workstudio` 声明，与导出的名字一致。`commands.json` 是固定构建产物；`skills` 只列目录，技能名称、描述与工作流由 `SKILL.md` 自身的规范结构承载。

### 8.2 动态实现

```ts
// 入口文件
export const workstudio = definePlugin({
  resources: {
    docx: {
      ls: async (ref) => outline(ref), // 文档大纲
      read: async (ref) => [{ locator: 'docx:para:12', text: '…' }],
      grep: async (ref, q) => [{ locator: 'docx:para:12', snippet: '…' }],
    },
  },
  commands: {
    'docx.insert': {
      summary: '在指定段落插入文本',
      args: {
        at: { type: 'locator', scheme: 'docx' },
        text: { type: 'string' },
      },
      run: async ({ ref, at, text }, ctx) => {
        await insert(ref, at, text);
        ctx.changed(ref, 'content');
        return { changed: at };
      },
    },
  },
  lifecycle: { activate, deactivate },
});
```

静态与动态的分界只有一条：**不执行代码就能知道的进清单，必须跑起来才有的进导出。**

### 8.3 构建拆分

一份源码在构建期被拆开：

| 产物         | 内容                   | 运行期读者 |
| ------------ | ---------------------- | ---------- |
| 引擎         | `run` 与数据接口的实现 | 激活后     |
| 命令描述     | 参数、摘要、退出码     | 扫描期     |
| 页面类型声明 | 页面的类型与参数形状   | 构建期     |
| 页面校验描述 | 运行期参数校验         | 页面加载后 |

### 8.4 页面 SDK 与类型

```ts
import '@workstudio/sdk/global';

const ref = new URLSearchParams(location.search).get('ref') ?? '';
await window.workStudio.subscribe('workspace', ref);
await window.workStudio.command('docx', 'docx', 'insert', { at, text });
```

- 类型来自页面类型声明，编译期检查；
- 参数在运行期按页面校验描述校验，早于引擎报错；
- 能力枚举、命令手册、授权单位出自同一份命令描述。

### 8.5 生命周期与管理层

```ts
interface DomainManager {
  register(pluginId: string, contribution: Contribution): Disposable;
  revoke(pluginId: string): void;
  resolve(addr: string): Target | null;
  dispatchCommand(call: CallContext): Promise<CallResult>;
  changed(ref: string, kind: 'content' | 'structure'): void;
}

interface PluginContext {
  fs: {
    read(ref: string): Promise<Uint8Array>;
    write(ref: string, bytes: Uint8Array): Promise<void>;
  };
  settings: { get<T>(): T; watch(cb: (next: T) => void): Disposable };
  changed(ref: string, kind: 'content' | 'structure'): void;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}
```

`ctx` 里没有绝对路径、没有进程对象、没有窗口。插件能拿到的就是这四项。

页面侧不提供 `createPage` 封装：唯一的页面入口是 `@workstudio/sdk/global` 的 `window.workStudio`，页面自己订阅投影、发送命令。

### 8.6 兼容

URA 与 v1 入口一起退役：`exports['./ura']` 不再装载。插件必须使用 `definePlugin` + `ResourceAdapter` + 命令；旧包不能直接安装。

## 九、页面、地址与渲染

### 9.1 scheme

只有两个 scheme 承担信任边界：

| scheme      | host     | 用途                                 |
| ----------- | -------- | ------------------------------------ |
| `work://`   | `studio` | 系统页：壳层、助手、捕获、欢迎、设置 |
| `plugin://` | 插件标识 | 插件页：内容与设置                   |

网页是内建 scheme，不注册；`file://` 只作为资源引用出现，不作为页面地址。

### 9.2 页面注册与协议处理

- scheme 在进程启动、就绪之前注册一次，声明为标准、安全、可抓取；
- 每个会话注册协议处理器：`work://` 走固定路由表，`plugin://` 走插件表加路径白名单；
- host 不注册：页面注册表是一张映射，安装插件加一条，卸载删一条并清理其来源下的存储；
- 未知 host 或非法路径返回统一错误页，不退化成读磁盘。

### 9.3 地址栏展示

显示的是地址的投影，不是加载地址本身：

| 页面     | 内部地址                      | 显示           |
| -------- | ----------------------------- | -------------- |
| 内置设置 | `work://studio/settings/…`    | 设置 · 卡片名  |
| 插件设置 | `plugin://docx/settings`      | 插件名 · 设置  |
| 文档     | `plugin://docx/content?ref=…` | 工作区相对路径 |
| 网页     | `https://…`                   | 域名与路径     |
| 邮件     | `plugin://mail/content?ref=…` | 邮件 · 主题    |

名称取自清单，内容标识取自 `ref`；系统绝对路径永不出现。展示与 scheme 注册无关，注册只决定能否加载。

### 9.4 视图与标签

| 层       | 职责                                     |
| -------- | ---------------------------------------- |
| 系统视图 | 壳层、助手、浮层、捕获层；位置由布局计算 |
| 内容标签 | 打开的资源；页面由插件提供，宿主是框架   |

标签语义：打开、切换、固定；关闭标签只影响页面，不影响资源。内容页在窗口内以受限页面运行，滚动条、主题与快捷键由框架注入。

### 9.5 列表

列表是投影：provider 产出快照，视图只消费。每个工作区一份（`workspace/<wsId>/list`），组可以声明聚合来源（`deps`），来源资源变化时只重算受影响的组。内置列表与插件列表共用同一条流程——注册、取数、分页、选择、动作都由框架处理，插件只提供条目与动作实现。

## 十、约束与验收

### 10.1 依赖与边界

| 约束                         | 说明                                    |
| ---------------------------- | --------------------------------------- |
| 渲染层不依赖 Node / Electron | 只有 bridge；页面不能发裸 IPC           |
| 插件不进渲染层视图树         | 页面按 `plugin://` 装载，生命周期归框架 |
| 域之间不直接引用             | 跨域走注册表或端口注入                  |
| 主进程内模块间不用 IPC       | 跨进程才走 IPC                          |
| 工具面不提供写与改           | 写与改只有命令                          |
| 框架不解释内容               | 解析与呈现属于域                        |

### 10.2 失败与降级

| 情形         | 处理                                   |
| ------------ | -------------------------------------- |
| 插件装载失败 | 记录诊断，其它插件继续；其地址不可路由 |
| 命令失败     | 返回结构化错误，页面按码处理           |
| 目标不存在   | `not_found`，不静默错位                |
| 外部修改     | 域收到变化后发变更，页面提示或重新读取 |
| 网页不可达   | 保留缓存快照，标记只读                 |
| 会话中断     | 任务状态落盘，重开后可恢复             |

### 10.3 不变量

1. 状态只有一个真相源：主进程。
2. 页面只能发 `(domain, resource, action)`，不能指定目标。
3. 写入只有一条路径：命令。
4. locator 只编码身份，不编码版本。
5. 读接口的条目必须带 locator。
6. 插件代码只在两处运行：激活后的入口与受限页面。
7. 命令描述只有一份，四条通道由它生成。
8. 插件的设置与数据不在页面存储里。

### 10.4 验收

| 场景           | 通过标准                                           |
| -------------- | -------------------------------------------------- |
| 打开并编辑文档 | 读、改、保存、外部变更提示都成立，两条入口结果一致 |
| 助手检索与写入 | 检索结果带 locator，写入后页面自动刷新，无需重读   |
| 插件安装与卸载 | 页面可开可关，卸载后地址不可路由、存储被清理       |
| 设置变更       | 立即生效，重启后保持，未知字段不被覆盖             |
| 插件页面类型   | 编译期类型正确，运行期非法参数被拒绝               |
| 工作区切换     | 资源、会话、布局按新工作区重建，App 级数据不变     |
| 网页快照       | 自动快照进缓存，保存后成为工作区资源               |
