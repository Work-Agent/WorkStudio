# WorkStudio

> 一个把工作资料当一等公民的桌面工作台：一屏之内管理项目空间的所有资料，让 AI 基于全部资料做全局理解与智能执行；人机在同一份真实内容上读写，产物落回原处，核对发生在对象上。

![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen) ![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**简体中文** | [English](./README.en.md)

> 这份文档讲需求与重点模块：从工作资料为什么会在工具之间散落，到三条主张如何回应，再到领域模型、产品形态与整体架构，最后落到能力扩展、状态与通讯、开发方式。它回答「为什么是 WorkStudio、重点模块如何设计」；实现细节由代码承载。
>
> 系统化设计见 [`docs/architecture.md`](./docs/architecture.md)：作用域 · 数据模型 · 契约 · 运行时 · 列表 / 视图 / 资源 · 扩展 · 验收。本文讲需求与重点模块，那里讲系统化设计；两文边界不重叠。

## 下载安装

[![Download](https://img.shields.io/badge/Download-Releases-2ea44f?style=for-the-badge)](https://github.com/Work-Agent/WorkStudio/releases/latest)

按钮进入 Releases 页面，在最新版本的 Assets 里按平台选择：macOS 选 `WorkStudio-mac-arm64.dmg`（Apple Silicon）或 `WorkStudio-mac-x64.dmg`（Intel），Windows 选 `WorkStudio-win-x64.exe`，Linux 选 `WorkStudio-linux-x64.AppImage`。

## 一、现状

### 1.1 垂直 Agent 的差异

| 维度     | Personal Agent | Coding Agent       | Work Agent（本项目）           |
| -------- | -------------- | ------------------ | ------------------------------ |
| 资料     | 少来源、云端   | 单一代码库         | 多来源、多格式、权限不一       |
| 内容     | 文本 / 会话    | 可执行、可验证     | 内容 + 数据（数据只给 schema） |
| 目的     | 完成一次任务   | 改对代码           | 在规则内完成业务操作           |
| 执行路线 | 检索 + 生成    | 生成 → 执行 → 验证 | 编排确定性工具，不生成代码     |

### 1.2 问题分析：两类代偿方案的缺口

办公日常的碎片集中在五个维度：来源、格式、版本、权限、语境。它们是工作本身的形态，不是缺陷。真正的成本在收敛：同一个交付物要过取材、理解、执行、回收、追溯、安全六道环节，每一道都要人重新找齐、转换、比对、确认。

动作不可复用、不可追溯，所以代价按任务数叠加（×N）。现状的两种应对都没有降低它：不用工作台，六道全部由人承担；用 Coding Agent，六道被改写成一次编程。

#### 五个维度：同一个交付物的五种身份

| 维度 | 一次任务里同时存在的                          | 每跨一次多做的动作 | 不收口的后果                                   |
| ---- | --------------------------------------------- | ------------------ | ---------------------------------------------- |
| 来源 | 本地文件夹、云盘共享、业务系统、网页、邮件    | 定位               | 找不全，也无法判断是否找全                     |
| 格式 | docx、xlsx、pdf、邮件、网页、画布             | 转换               | 转文本或截图后，表格关系、层级、批注、修订消失 |
| 版本 | 终版、终版(2)、系统导出、邮件副本、云盘在线版 | 比对               | 没有权威版本标识，改完才发现改的是过期文件     |
| 权限 | 云盘链接、系统角色、邮箱委托、目录 ACL        | 确认               | 可见性靠人逐一确认；权限只能按目录收窄         |
| 语境 | 模板、审批要求、部门口径、口头约定、历史先例  | 复述               | 每个任务重新补充，补的内容不进任何记录         |

#### 六道代价：每一道都要人重新收敛

| 环节 | 不收口时，人做的收敛动作                                                                     | 代价                                                         |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 取材 | 在五处入口各找一遍；下载副本、另存副本、邮件附件并存                                         | 找不全，也无法判断是否找全；取到旧版才发现                   |
| 理解 | 六种格式各用一套打开方式；转纯文本或截图；业务数据只见界面不见字段；规则散在文档与口头约定里 | 判据随工具变化；表格关系、批注、修订消失；规则每个任务重新补 |
| 执行 | 人是流程引擎：在多个界面里复制、比对、填写、提交；既无幂等，也无串行                         | 步骤不可回放；重复提交；后写覆盖先写                         |
| 回收 | 产物先落成文件，再由人搬回业务系统；导出 → 编辑 → 导入 往返                                  | 样式、公式、超链接、修订被破坏                               |
| 追溯 | 说不清结论基于哪份资料、哪一版；操作散在各系统日志里                                         | 复核只能重做一遍，换人从零开始                               |
| 安全 | 资料经邮件、共享链接、截图流转；权限只能按目录给；脱敏靠手工删                               | 谁看过无从追踪；没有到期回收，合规没有凭据                   |

六道不是一次性的：每个新任务都从取材重走一遍，动作不能复用、过程不能追溯，代价随任务数线性增长。

#### 两种代偿：代价只是换了支付方

| 代偿           | 谁付      | 代价变成什么                         | 缺口                                                     |
| -------------- | --------- | ------------------------------------ | -------------------------------------------------------- |
| A 不用工作台   | 人        | 六道手工重做                         | 人成为流程引擎，动作不可复用、不可追溯                   |
| B Coding Agent | 模型 + 人 | 六道改写成脚本：生成 → 执行 → 人核对 | 解析、字段映射、写回、验证都由脚本自理，普通用户无法确认 |

B 的六道没有消失，只是每一道都多了一次编程：每类来源重写解析，字段映射靠猜，写回只能落文件或模拟点击，失败只有堆栈，正确性靠人读脚本。

#### 归并

| 痛点簇                 | 缺口的能力                                           | 对应主张                 |
| ---------------------- | ---------------------------------------------------- | ------------------------ |
| 取材、理解、回收、安全 | 资料有唯一身份、只解释一次、写入只有一条通道         | **一条资源管道**         |
| 执行、回收             | 唯一状态，人的操作与 AI 执行同一入口，写入不互相覆盖 | **一棵状态树、一次投影** |
| 追溯、复用与门槛       | 内容可在原处读、改、核对，动作留痕                   | **内容表面独立**         |

五个维度不变，变的是谁来付收敛那笔代价：A 留给人，B 变成一次编程。WorkStudio 把它收进管道。

### 1.3 三条设计主张

| 主张                     | 机制                                                               | 消除的问题                       |
| ------------------------ | ------------------------------------------------------------------ | -------------------------------- |
| **一条资源管道**         | 工作区的资料统一登记、只解释一次；人、页面与 AI 共用同一条读写通道 | 多套读写、格式耦合、副本失控     |
| **一棵状态树、一次投影** | 主进程持唯一状态；手动操作与 AI 执行同一个入口；界面只消费投影     | 写覆盖、人机两套逻辑、状态不同步 |
| **内容表面独立**         | 标签内容一律原生视图，人在原处直接读、直接改、直接核对             | 壳层遮挡、验证滞后               |

## 二、领域模型

**聚合根是工作区**：它同时是隔离边界、持久化边界与换代边界。工作区之下两条主线——文件（人用面）与会话（AI 用面）——消费同一份资源。

```
Workspace（聚合根）
├─ Files 文件
│   ├─ 分组 / 目录 / 查找（派生，可重建）
│   └─ 文档：查看 · 编辑 · 保存 · 检索 · 订阅
├─ Sessions 会话
│   ├─ 上下文：系统提示 · 资源地图 · 技能选中集
│   ├─ 消息与工具调用（真相在 pi）
│   └─ 运行时：流式 · 队列 · 模型档位
├─ Scene 现场：栏宽 · 打开集合键 · 助手形态
└─ View collection 打开集合：标签顺序 · 激活位 · 固定位

横向能力
├─ 插件：资源实现 + 页面 + 资源组 + 动作
├─ 设置：内置页面清单
└─ 浏览器：在线网页 + 自动化
```

| 实体       | 标识                             | 真相源                | 持久化            |
| ---------- | -------------------------------- | --------------------- | ----------------- |
| 工作区     | 路径                             | 工作区注册表          | 自描述文件        |
| 资源       | ref（scheme + authority + path） | 来源                  | 来源侧 + 派生层   |
| 会话       | 会话文件                         | pi 会话管理器         | 会话文件          |
| 插件       | 插件 id                          | 插件清单              | 插件根 / 安装目录 |
| 页面       | 插件 id 或设置页 id              | 插件清单 / 设置注册表 | 页面文件          |
| 模型与配置 | provider / model id              | pi 设置与凭证链       | 设置文件          |

## 三、产品形态

同一份资源有三种主语：文件说「我有什么」，会话说「我要做什么」，插件说「我有哪些能力」。三者不平权——会话不持有数据，插件不持有身份与状态，也不直接执行——所以定下主视角，产品形态就同时定了：

| 主视角 | 角色   | 产品回答的问题                 | 形态       | 另外两个的位置           |
| ------ | ------ | ------------------------------ | ---------- | ------------------------ |
| 文件   | 人     | 我有什么资源，用怎样的过程处理 | **Studio** | 会话是过程，插件是扩展   |
| 会话   | AI     | 我要做什么，过程中取哪些资料   | Chat       | 文件是上下文，插件是工具 |
| 插件   | 扩展者 | 我有哪些能力，能拼出什么桌面   | 虚拟桌面   | 文件与会话都只是能力窗口 |

三条路都成立，服务的工作不同。本项目选 Studio：

1. **产物是资料，不是对话**。岗位工作交付的是文档、表格、系统里的记录；对话可以丢，产物必须留。以会话为主视角，交付物还得从上下文里二次搬出去。
2. **核对只能发生在对象上**。正确性靠人在最终产物上确认；只有文件在场，才谈得上同一份、可回读、可实时核对，不必在过程记录里推断。
3. **扩展不能污染状态**。以插件为主视角，产品退回能力窗口的集合，文件与会话被各能力瓜分。

代价是产品比聊天框重：要有工作区、原生视图、本地文件与系统集成，「AI 在真实资料上动手、人当场核对」才成立。

结论：主视角是文件，会话是过程，插件是扩展，产品只能是 Studio。

工作台按「资料 → 处理 → 核对成果」组织：

| 区域       | 职责                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 左侧资料栏 | 来源就地展开，按名称或路径查找，切换管理页时仍保留资料入口             |
| 中央内容区 | 文档、网页、欢迎页；能力管理和设置各自复用管理标签                     |
| 右侧助手   | 打开的会话标签、执行状态、工具过程、可打开核对的成果；完整历史单独管理 |

标题栏的空白和地址显示区域均可拖动主窗口到其他屏幕；按钮保持正常点击，地址提供复制入口。
欢迎页从已登记工作区中切换，也可选择其他目录。不可用目录明确标识，自定义名称在切换后保留。
编辑草稿在关闭、重读、批量关闭、切换工作区和退出前确认保存、放弃或取消；外部变更和保存失败保留草稿，允许另存副本。

## 四、整体架构

渲染层是多页面应用：工作台、助手、浮层、设置、欢迎页各自独立入口，共享同一个 `window.workStudio` 通讯桥与共享样式；每个页面只订阅自己消费的资源。

```text
Renderer pages
  shell / assistant / overlay / settings / welcome
        │ window.workStudio
        │ subscribe / command / notify / onUpdate
Runtime
  DomainRegistry · Dispatcher · 日志 / 存储 / 网络适配
Domains
  workspaces · resources · plugins
  shell · settings
  sessions · models · skills · thinking · extensions · tools · prompts · themes
Domain modules
  workspace：工作区生命周期组合（workspaces + resources + plugins）
  shell / settings / agent
Agent Layer
  pi runtime · harness · tools · 会话持久化
        │ 官方扩展点
     pi SDK / URA
```

- **Domain / Resource 是运行单位**：domain 按能力拆分（workspaces / resources / plugins / shell / settings，以及 agent 下的 sessions / models / skills / thinking / extensions / tools / prompts / themes），只声明状态、命令、订阅与推送；生命周期按依赖合并为 workspace / shell / settings / agent 四个 DomainModule，不再有 Capability、controller 或单独的生命周期接口。
- **工作区是 scope，不是 domain**：工作区作用域的资源在 resource 名里带 wsId（如 `workspace/<wsId>/resources`）；窗口与工作区 1:1，窗口按自己绑定的工作区订阅。
- **Runtime 管框架**：DomainRegistry、Dispatcher 与存储 / 日志 / 网络适配只处理跨领域机制，不承载业务状态。
- **DomainModule 拥有实现**：workspace module 管理资源 / URA / 资源森林；插件注册表归 App；shell 管理窗口 / 视图 / 布局 / 主题；settings 管理设置 / 更新；Agent 引擎在独立 Agent Layer，由 AgentDomain 持有，并拆成 sessions / models / skills / thinking / extensions / tools / prompts / themes 域。
- **依赖显式排序**：DomainModule 声明 `dependencies`，DomainRegistry 按拓扑序 start、反向 stop；不引入 DI 容器。
- **App 是组合根**：只负责进程生命周期、窗口、视图 provider、IPC 与四个 DomainModule 的装配。
- **视图分两层**：窗口级系统视图（助手 / 浮层 / 捕获层）与内容标签（资源页 / 网页）分离；Views 只做承载、几何、显隐与栈序。
- **Layout / Scene 是窗口级契约**：布局由主进程计算，拖拽只是临时 preview；提交后写 scene，DOM 与原生视图消费同一份几何。
- **资源森林是 provider 管道**：文件列表按工作区产出森林，每个组是一棵树；插件注册表是 App 级独立资源，不走工作区森林。
- **Settings 是单页 domain 消费方**：所有卡片在一个页面内展开，更新状态是 `settings` domain 的 `updates` resource。
- **IPC 日志内建**：Dispatcher 直接记录请求地址、来源、耗时与结果；不引入 middleware，也不记录 input。
- **资源页与浏览器分开**：资源页走 URA 的 transport / codec / presenter；浏览器页整段旁路，直接由视图宿主导航。
- **单一通讯面**：渲染层只使用 `workStudio`，资源页 / 插件页通过 `window.extension` 暴露受限能力；不暴露裸 IPC。
- **依赖单向**：Renderer → workStudio → Runtime / Domains → Agent Layer / URA → pi SDK。

## 五、能力扩展

### 5.1 一条管道，三种扩展

任何软件对数据的处理都是同一条通道：取到字节 → 解释成结构 → 呈现给人或交给程序消费；反向由消费侧发起修改，沿同一张绑定表逐层编码回去。WorkStudio 把它切成三段，切分的依据不是职责划分，而是**身份标志**：每段只认一个标志，标志变了就是另一个实现。

| 段        | 认的标志                                | 标志来自                      | 换掉它等于                 |
| --------- | --------------------------------------- | ----------------------------- | -------------------------- |
| transport | scheme                                  | ref `scheme://authority/path` | 换来源                     |
| codec     | MIME                                    | transport 返回的规范值        | 换格式解释                 |
| consumer  | codec（`(transport, mime)` 的解析结果） | 绑定表                        | 换出口：页面 / 文本 / 数据 |

- **两个数据身份、一个实现身份**：ref 定来源，MIME 定格式，codec 定“这份文档是谁解的”；出口、store 与写回都跟着 codec 走，不再另造 docType。
- **段与段靠标志对接，不靠约定**：标志在，段就可替换，其余段不动；标志缺失（未知 MIME、无 codec）降级 raw，掉出分段。
- **通道是双向的**：读从标志往下走，写在同一张绑定表上往回走——定位 → 编码（最小补丁）→ 来源提交。

插件、设置、浏览器不是三套设施，而是这条通道上的三个位置：插件替换段，设置只占终点，浏览器整段旁路。差别只在谁拥有代码与生命周期、以及从哪里接进来。框架核心只内建 `file` / `http` / `https` 三种来源，其余来源与格式由插件注册。

| 承载       | 位置                                                                       | 拥有者与生命周期   | 扩展方式               |
| ---------- | -------------------------------------------------------------------------- | ------------------ | ---------------------- |
| **插件**   | 替换段：注册 transport / codec / store / consumer，并自带页面              | 安装者：可装可卸   | 对外开放的唯一扩展形态 |
| **设置**   | 只占终点：框架自带页面，不经 codec / store                                 | 框架：随版本发布   | 框架内新增一页         |
| **浏览器** | 整段旁路：实时视图直接嵌入；白名单域名整理成站点集合，随资源地图同步给侧车 | 框架：不随内容变化 | 内建，不逐站配置       |

```
┌────────────────────────── WorkStudio ──────────────────────────┐
│                                                                │
│  插件                         设置                  浏览器      │
│  可安装包                     内置页面              内建运行时  │
│  ┌──────────────┐          ┌──────────────┐      ┌───────────┐ │
│  │ 注册面 + 页面 │          │ settings://   │      │ 在线网页  │ │
│  │ URA 实现      │          │ <id> 内置页面 │      │ 自动化    │ │
│  └──────┬───────┘          └──────┬───────┘      └─────┬─────┘ │
│         │                         │                    │       │
│         └───────────┬─────────────┴────────────┬───────┘       │
│                     ▼                          ▼               │
│               URA 资源管道              页面与视图宿主          │
└────────────────────────────────────────────────────────────────┘
```

**边界**（三者的所有权不重叠）：

| 维度   | 管道（框架）                                         | 侧车（pi + harness）                  | 形态（插件 · 设置 · 浏览器）                                                |
| ------ | ---------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| 拥有   | ref、绑定表、写队列、页面会话、派生索引              | 会话、轮次、上下文、工具编排          | 插件：所填的段与自己的页面；设置：页面与清单；浏览器：实时视图与自动化      |
| 不拥有 | 内容本身（真相在来源）                               | 资源实现、页面、状态树                | ref 身份、绑定表、写队列、会话、别的形态的东西                              |
| 入口   | 门面：read / write / edit / grep / find / ls / query | 7 个资源工具 + 操作型工具（形态注入） | 插件：SDK 注册，装载时求值；设置：`settings.list`；浏览器：`browser_*` 契约 |
| 出口   | 文本 / schema / 页面入口                             | 消息与工具调用（真相在 pi）           | 插件与设置：页面投影 + 白名单命令；浏览器：快照文件与站点集合               |

- **只经门面**：侧车与页面都不碰文件系统与来源协议；插件实现被门面调用，不反向驱动侧车。
- **身份不外包**：ref、绑定、写队列、脏标记归框架；插件只声明能处理什么（`(transport, mime)` 与 codec），不新建身份空间。
- **页面不越界**：插件页没有 Node，不直连 pi，只拿投影与白名单命令。
- **能力经工具暴露**：插件不给模型加代码执行；能力以确定性工具与命令出现，侧车只编排。
- **实时视图直连**：浏览器由视图宿主直接导航，不跑 transport / codec；网页只以快照文件回到管道。

### 5.2 浏览器：整段旁路

在线系统在服务端已经把「取 → 解释 → 呈现」走完了，交付物就是渲染好的页面；客户端再解一遍只会得到同一份结果的劣化副本。所以在线系统不重跑管道，直接用浏览器把实时视图嵌进来。transport / codec / store / 绑定，它一段都不用。

```
实时（不经管道）：
URL ─► 视图宿主 ─► WebContentsView 导航（共享浏览器 session）─► render consumer
                                                                ├ 文本    ─► 侧车（read / snapshot）
                                                                └ Markdown ─► sites/<domain>/

操作（不经管道）：
意图 ─► 自动化 click / type / submit ─► 站点自己完成

进入资源地图（不经 transport / codec）：
sites/<domain>/*.md（已是 Markdown）─► 站点集合：域 → 页面
                                       └─► 资源地图 ─► 侧车（下一轮可见）

人的入口（不经 transport / codec）：
站点条目（标题 + URL）─► 视图宿主 ─► WebContentsView 导航 ─► 实时视图（真实网页）
```

| 环节 | 浏览器                          | 插件管道                                                  |
| ---- | ------------------------------- | --------------------------------------------------------- |
| 取数 | 导航                            | transport                                                 |
| 解释 | 站点自身（服务端 + 浏览器内核） | codec                                                     |
| 结构 | 两层集合：域 → 页               | store                                                     |
| 选择 | 无：只有一条路                  | 两级绑定 `(transport, mime)` → `(transport, mime, codec)` |
| 写入 | 自动化操作站点界面              | 写会话：草稿 → 编码 → 提交                                |

- **共享 session**：所有网页标签共用一个浏览器会话，登录态、cookie 与缓存一致；临时标签与整理出的站点内容同源。
- **导航直连**：打开 = 视图宿主让 WebContentsView 导航；不预取、不解码、不产生 ref，也不订阅变更。
- **快照不走 transport / codec**：浏览器交出的就是 Markdown，直接按文档登记，没有自己的解释环节；检索与侧车读取与本地文档同一套。
- **人看实时页面，侧车看投影**：侧栏的站点条目展示快照头部的页面标题与 URL，点开即在实时视图里导航到该 URL（同一 URL 已打开则激活）；快照 Markdown（正文 + 可访问性结构）只服务侧车与资源地图，不作为人的阅读入口。
- **快照属应用管理的空间**：站点内容写在应用管理的 `sites/<domain>/` 下，只有浏览器写入；用户不直接编辑，所以不存在「外部改动」语义，也不进写队列。
- **分层入图**：域是一个集合分组、页面是条目，资源地图按「站点 → 页面」两层注入——侧车拿到的不是一条条扁平 ref。
- **白名单域 = 采集域**：域下多页由 render consumer 转 Markdown 后入集合；名单外只作临时标签，不落盘、不进资源地图。
- **自动化 = CDP 操作 + 注入提取**：点击 / 输入 / 后退走 `webContents.debugger` 的 `Input.*`，截图走 `Page.captureScreenshot`；正文（Readability）、可访问性结构与可交互性标记由注入遍历产出——都是浏览器能力的内置模块，随应用打包，不依赖页面配合。
- **注入不改站点**：提取与标记层在页面内即时生效、关闭即撤，不留持久副作用；页面仍然无桥、无 Node。
- **自动化只给侧车**：`browser_*` 是唯一入口，页面、插件、命令都不暴露这层能力；人直接操作实时视图，工具层只依赖操作型契约。
- **没有 edit**：网页没有草稿与编码环节，写入只发生在站点内部。
- **本地 HTML 走插件页面**：只有 `live` 能力才选择浏览器表现层。

#### 快照文件

一个站点页面对应一个 Markdown 文件，三段一次写入：

```text
---
url: https://example.com/reports/2026-q1
title: 2026 年第一季度经营分析
excerpt: 收入、成本与毛利的分季度对比……
domain: example.com
capturedAt: 2026-04-02T09:31:00Z
---

<Readability 正文>

## 可访问性结构

main   "经营分析"   #content > main
button "导出"       button.export
table  "季度对比"   table:nth-of-type(1)
```

| 段       | 内容                                                                 | 谁用                                  |
| -------- | -------------------------------------------------------------------- | ------------------------------------- |
| 头部     | `url` · Readability 的 `title` / `excerpt` · `domain` · `capturedAt` | 集合行（标题 + 网址）、打开入口、去重 |
| 正文     | Readability 提取的正文 Markdown                                      | 侧车上下文、检索                      |
| 可访问性 | landmark / 标题层级 / 交互元素的 role · name · selector              | 自动化定位、结构核对                  |

- **文件名 = 路径 slug + URL 哈希**：同一 URL 重抓覆盖同一个文件，不产生副本。
- **正文是投影不是原文**：不用于回写，也不作为人的阅读入口；站点内容只能回站点改，人看的是实时页面。
- **可访问性段是索引**：侧车默认只取正文，需要定位或核对结构时才读尾部。
- **三段各有归属**：`url` 是回对在线页面的唯一凭据；Readability 提供可读正文与概述；可访问性结构让自动化不必靠视觉猜位置。

### 5.3 插件：填段

插件就是能把 5.1 的三段填上的东西：它注册 transport / codec / store / consumer / presenter / sidecar，外加资源组与动作。框架核心只内建 `file` / `http` / `https` 与少数内置 codec（它们本质上也是插件），其余来源与格式都由插件填。这条管道即 URA；在线网页不进它（见 5.2）。

```
读：
ref ─► transport ─► RawContent{mime, bytes}
    ─► 绑定(transport, mime) ─► codec ─► 文档 ─► store ─► 可查询数据
    ─► 绑定(transport, mime, codec) ─► presenter
           ├ page      ─► 资源页（render / edit）
           ├ settings  ─► 插件设置页（配置 / 详情，归设置面）
           └ sidecar   ─► 文本 / schema

各段由谁填：
transport   框架内建 file / http / https；插件可新增或覆盖
codec/store 插件（含内置插件）
presenter   page / settings / sidecar 都由插件注册；未注册时回退 raw：文本类进通用文本页，二进制明确报「无可用查看器」

选择顺序：绑定 ─► MIME ─► raw

写：
变更 ─► 定位 ─► 编码（最小补丁） ─► 来源提交 ─► 数据更新 ─► 广播
```

| 段        | 职责                                                            |
| --------- | --------------------------------------------------------------- |
| transport | 协议 → RawContent（mime、bytes）；能力在注册时声明              |
| codec     | 声明 `(transport, mime)` → 文档                                 |
| store     | 绑在 codec 上：文档 → 结构化查询（派生）                        |
| consumer  | 声明 `(transport, mime, codec)` → 页面（渲染 / 编辑）· 文本出口 |
| resource  | 资源组定义 + 工作区 provider；文件树与插件注册表分开            |
| action    | 地址栏动作                                                      |

- **段可以拆开填**：一个插件能只填一段（只加一种 codec），也能填整条（来源 + 格式 + 页面）；填哪段由注册接口决定，不要求包办全链。
- **两类页面归属不同**：`page` 是资源页，入口与键都归 URA；`settings` 是插件配置 / 详情页，页面由插件提供，但清单、入口与 ref 归设置面（侧栏插件注册表、安装时详情）。两者共用同一套页面装载与白名单桥。
- **填段不改身份**：插件只声明能处理什么（`(transport, mime)` 与 codec）；ref、绑定表、写队列仍归框架。

关键决策：

- **ref 是身份**：`scheme://authority/path`；不带格式、出口、表现层。
- **MIME 是格式身份**：MIME 由 transport 给出（文件按扩展名；HTTP 按 `Content-Type`，缺失或只给 `application/octet-stream` 时按 URL 扩展名兜底）；codec 只声明自己能解释哪些 `(transport, mime)`；不嗅探字节，给不出 MIME 即 raw。
- **绑定分两级**：codec 认 `(transport, mime)`，presenter 认 `(transport, mime, codec)`。出口跟着 codec 走——同一来源同一格式可因换 codec 而换页面，不需要意图参数。同键后注册者胜出并记诊断；用户绑定写应用数据目录，启动时加载。
- **agent 读取面是 sidecar 出口**：不参与页面竞争，始终把文档 / 原始字节转成文本或 schema。它不扫文件系统——进来的是资源地图选中的 ref，出去的是文本。
- **读写同一门面**：AI 工具、页面、命令都走同一实现；写经过草稿 → 提交 → 分片队列，后写覆盖先写。
- **失败降级 raw**：任一环缺失都返回原始内容与兜底页，并记录降级点。

#### 插件包、zip 与可安装清单

插件是一个自包含目录：`package.json` 的 `workstudio` 字段声明 id / label / pages / skills / claims；`exports["./workstudio"]` 指向 `definePlugin` 的 ESM 入口，`commands.json` 由构建生成。插件以 zip 分发，一个 zip 只装一个插件。

```text
plugin-docx.zip
├── package.json
├── dist/engine.js
├── commands.json
├── dist/page/...
└── node_modules/        # 可选；依赖由插件自己 bundle
```

| 来源     | 写法                                         | 落盘                                 |
| -------- | -------------------------------------------- | ------------------------------------ |
| 远程 zip | `https://.../plugin.zip#sha256=...`          | `<appData>/plugins/installed/<id>/`  |
| 本地 zip | `~/Downloads/plugin.zip`                     | `<appData>/plugins/installed/<id>/`  |
| 本地目录 | 绝对路径                                     | 复制到 `installed/<id>/`，源目录不动 |
| 注册表   | `catalog:<id>`，由清单条目给出 URL 与 sha256 | `<appData>/plugins/installed/<id>/`  |

**可安装清单是独立注册表**（Work Studio Plugin Registry），不再随应用源码维护：

- 一个插件一个条目 JSON，CI 校验字段、id、版本与 sha256，合并后生成 `index.json`；
- 条目字段：`id` / `name` / `description` / `version` / `source` / `sha256` / `repo` / `tags` / `category`；`source` 必须是自包含 zip，`sha256` 固定具体产物；
- 应用启动只读缓存；打开插件设置页或手动刷新时才拉取 `index.json`；默认走 GitHub raw，显式刷新会穿透分支缓存；请求带条件头，失败回退缓存并标记 `stale`；
- 清单只负责发现：安装仍以 zip 内的 manifest 为准，清单 id 与 manifest id 必须一致；
- 注册表用 `builtin: true` 标记随安装包分发的插件；打包时按条目下载、校验 sha256 后放入 `out/plugins/`，启动时播种到 `installed/`，其 id 保留，外部包不可覆盖；
- 无自动更新：目录版本高于已安装版本时显示「可更新」，用户点击后才安装。

注册表契约见 [`docs/plugin-registry.md`](./docs/plugin-registry.md)。

安装流水线：

```text
source（catalog:<id> / URL / zip / 目录）
  ─► 下载 ─► 校验 sha256 ─► 解包 ─► 校验 manifest / 入口 / commands.json
  ─► staging ─► 原子替换 installed/<id> ─► 激活
```

- **目录即真相**：不维护 `installed.json`；启动扫描 `installed/<id>/package.json`，id、版本与页面都从包内读取；
- **坏包可见**：解析失败或目录名与 manifest id 不一致时保留为 `broken`，仍可卸载；
- **安装与加载分别报告**：提交完成代表包已原子换入 `installed/<id>`；激活失败保留包并记录错误，可重载或卸载；安装失败回滚旧版本；
- **原子替换**：旧包先移入 `recovery/`，新包换入后再清理；启动时恢复中断的替换；
- **远程必须带 sha256**：注册表条目显式给出；手动 URL 用 `#sha256=`；本地 zip 只计算不比对；
- **zip 自包含**：依赖 bundle 进 `dist` 或随 zip 带 `node_modules`；安装时不跑 npm；
- **开发档与安装包分档**：profile 按运行方式分开——安装包用 `WorkStudio`，`pnpm dev` 用 `WorkStudio Dev`（显式 `--user-data-dir` 优先）；业务数据仍可用 `--data-dir` / `WA_DATA_DIR` 覆盖。开发时的插件、工作区与设置不会落进正式数据根；
- **插件目录统一**：`<appData>/plugins/` 下只有 `installed/`、`staging/`、`recovery/`、`tmp/`、`data/`、`catalog/`；与工作区无关，和 `agent/` 下的 pi 资源分开；
- **卸载**：撤销注册、关闭插件页面、删除包目录；配置默认保留，显式清除才删 `data/<id>`；
- **任务只属于当前进程**：下载字节进度、校验、提交、激活分阶段报告；取消只在提交前生效，不承诺重启续传；
- **热装卸**：安装 / 卸载即时生效；ESM 模块本体留在进程内存，重载通过新的模块地址拿到新实例，属已知限制。

### 5.4 设置：只占页面出口

设置不碰管道：没有 transport / codec / store，只有页面与清单。它收两类页：框架内置页与插件设置页。

- **框架内置页**：清单与页面都由主进程拥有，页面目录与插件页分开；
- **插件设置页**：页面由插件提供（`settings` 入口），用来管理该插件的配置；从侧栏插件列表进入，安装完成后即可作为该插件的 home；
- `settings.list` 投影内置页清单；插件设置页从侧栏插件列表进入，`views.open({ type: 'settings' })` 按 ref 打开；
- **ref 自带 scheme**：内置页为 `settings://<id>`，插件设置页为 `settings://plugin.<id>`；标签集合、地址栏与页面会话都按 ref 认它；
- 物理装载与插件页共用 `app://page` 协议、preload 桥、主题广播与会话生命周期；
- 新增内置设置 = 加一页 + 一条清单；插件设置页随插件版本走；两者都不单独进安装与信任流程；
- **模型与配置页**：新增自定义模型默认写出 `compat.supportsDeveloperRole: false`（第三方端点普遍只接受 `system` 指令角色）；已有模型配置不回写、不迁移。
- 页面只读自己的分区与白名单命令，不直连来源。

| 设置入口         | 用户任务                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 外观与主题       | 浅色 / 深色 / 跟随系统；内容视图按百分比缩放                                                                                                                             |
| 偏好设置         | 明确区分应用默认与当前工作区覆盖；恢复继承，保存前保护表单修改                                                                                                           |
| 模型连接         | 账号入口置顶；供应商下展开其模型列表；「登录」打开授权页/登录页，provider 回调本机回环后由主进程换 token 写库；只有未声明授权页的供应商才走 API Key 配置；退出统一清凭证 |
| 能力管理         | 插件注册表、技能、助手扩展分别展示来源、作用域和真实运行状态                                                                                                             |
| 资源诊断         | 使用资料栏同一份来源状态、计数和错误；高级注册信息按需展开                                                                                                               |
| 存储、关于与更新 | 常用位置和版本状态优先，高级路径与访问令牌按需展开                                                                                                                       |

外观属于应用级偏好，切换工作区与重启后保留；主题只有浅色 / 深色 / 跟随系统三种语义。界面缩放通过内容视图的缩放百分比生效，壳层布局不被缩放。外部网站和文档自身的预览配色保持原样。

## 六、状态与通讯

### 6.1 三级状态

| 级别          | 拥有                                                                                      | 生命周期   | 持久化                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| **App**       | 模型目录、凭证、插件安装、Pi 包、全局设置、系统视图、工作区列表、当前工作区               | 进程       | `agentDir` / 官方凭证链                                                           |
| **Workspace** | 项目设置、URA、资源森林、标签视图、UI 现场、页面 / 写会话、会话索引、浏览器策略、派生数据 | 打开工作区 | `workspace.json` / `ui-state.json` / `settings.json` / `sessions/` / `resources/` |
| **Session**   | pi runtime、消息、轮次、队列、上下文（资源地图版本、AGENTS、技能激活）                    | 会话       | `sessions/*.jsonl`                                                                |

- **工作区生命周期由 App 管理**：窗口与工作区一一对应；工作区切换释放旧运行时并重绑新运行时。
- **Session 真相在 pi**：切换会话委托 pi；WorkStudio 只持投影，技能激活随会话上下文解析。
- **资源、页面、技能是加载方式**：App 装全局资源，Workspace 装工作区资源，Session 只激活；目录全部在 App 私有数据目录，不读 `~/.pi` 或真实工作区 `.pi`。
- **能力作用域**：助手扩展保留 Pi 包的用户级 / 项目级配置；技能启用状态归工作区，本轮选择只限定当前请求。
- **切换语义**：工作区切换 = 旧作用域释放 + 新作用域加载；会话切换 = pi 切换 + 事件桥重绑。
- **任务状态**：助手按实际执行报告运行、停止中、已停止、未确认、失败与结束。停止等待运行时确认，已完成的文件操作不会撤销；重试重新发送原请求，可能有副作用时先提示检查成果。执行结束不代表用户已核对成果。
- **安装状态**：插件下载展示实际字节进度，校验、安装、加载分别报告。取消等待当前步骤返回；失败可以重试或更换来源，完整性校验失败必须更换来源。切换管理页仍可从资料栏查看当前任务；关闭前等待取消确认。任务进度属于当前进程，不承诺重启续传。

### 6.2 通讯

| 通道                     | 方向                     | 语义                                                    |
| ------------------------ | ------------------------ | ------------------------------------------------------- |
| `workStudio.subscribe`   | 渲染 → 主进程            | 订阅 `(domain, resource)`，返回 snapshot 并建立后续推送 |
| `workStudio.unsubscribe` | 渲染 → 主进程            | 取消订阅                                                |
| `workStudio.command`     | 渲染 → 主进程            | 有回复命令，返回 `ok/data` 或错误                       |
| `workStudio.notify`      | 渲染 → 主进程            | 无回复命令                                              |
| `workStudio.onUpdate`    | 主进程 → 渲染            | snapshot / patch / event 帧                             |
| `window.extension`       | 资源页 / 插件页 → 主进程 | 受限的资源页面命令与内容总线                            |

- **snapshot / patch / event**：订阅先返回完整快照；后续只推变化。资源是订阅和推送的最小单位。
- **命令回执**：command 始终返回带 `ok` 的结果；notify 不等待结果。
- **内容页**：资源页 / 插件页只暴露 `window.extension`；内部通过 workStudio 资源命令与 `ws:bus` 完成内容投递、保存、重载与动作。
- **单写者**：渲染层不直接改主进程状态；页面无 Node、无裸 IPC。
- **切换语义**：工作区切换释放旧运行时并重绑新运行时；会话切换重绑 Agent 运行时，旧订阅由资源生命周期收敛。

## 七、开发

### 7.1 环境与启动

- Node.js ≥ 22.12，pnpm ≥ 12

```bash
pnpm install
pnpm dev      # 开发模式（Vite HMR）
```

首次安装要下载 Electron 二进制。**中国大陆网络环境**下下载缓慢或失败时，可用镜像或代理（二选一，`pnpm install` 前生效）：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/          # 镜像
export https_proxy=http://127.0.0.1:7890 ELECTRON_GET_USE_PROXY=true   # 代理
```

出现 `Error: Electron uninstall`、或 `node_modules/electron/path.txt` 为空，说明二进制补齐步骤被跳过（如 `--ignore-scripts`）。Electron 44 起上游不再自带安装脚本，下载由本项目的 `postinstall` 负责，补跑一次即可：

```bash
node node_modules/electron/install.js
```

### 7.2 常用脚本

| 命令                 | 说明                                             |
| -------------------- | ------------------------------------------------ |
| `pnpm dev`           | 启动开发模式（支持 Vite HMR）                    |
| `pnpm run build`     | 仅编译三端产物到 `out/`（不打包）                |
| `pnpm run preview`   | 用已编译产物启动应用（验证生产构建）             |
| `pnpm run package`   | 打包为未压缩应用目录，输出到 `dist/`             |
| `pnpm plugins:sync`  | 按注册表 `builtin` 同步内置插件到 `out/plugins/` |
| `pnpm run make`      | 生成当前平台的安装包，输出到 `dist/`             |
| `pnpm run release`   | 构建并发布（需配置 publish 凭据）                |
| `pnpm run typecheck` | TypeScript 类型检查                              |
| `pnpm run lint`      | oxlint + oxfmt 代码检查                          |
| `pnpm run lint:fix`  | 自动修复代码风格                                 |
| `pnpm run verify`    | 一次性跑 CI 同款检查（typecheck / lint / build） |

`pnpm verify` 按 `typecheck → lint → build` 顺序执行，与 CI 的 js job 同源。

### 7.3 项目结构

```
├── src/
│   ├── main/
│   │   ├── app.ts / index.ts      # 组合根 / Electron 入口
│   │   ├── runtime/               # DomainRegistry / Dispatcher / storage / log / net
│   │   ├── domains/               # workspaces / resources / plugins / shell / settings / agent
│   │   └── agent/                 # Agent Layer：pi runtime / harness / tools / sessions
│   ├── preload/                   # 多页面与内容视图的 preload 契约
│   ├── renderer/
│   │   ├── pages/                 # shell / assistant / overlay / settings / welcome
│   │   └── shared/                # 跨页面 API、domain 与样式
│   └── shared/                    # 主/渲染共享类型与样式
├── scripts/                       # 发版 / 内置插件同步等构建脚本
├── RELEASING.md                   # 发版与 SDK 发布规则
├── docs/                          # 系统化设计（architecture / plugin-registry）
├── electron.vite.config.ts        # 三端构建配置（main / preload / renderer）
├── electron-builder.yml           # 打包配置（目标平台、fuses、签名）
└── tsconfig.json
```

### 7.4 构建与打包

- 构建产物 `out/{main,preload,renderer}` 与打包产物 `dist/` 都不进版本库。
- 打包前会执行 `pnpm plugins:sync`：读取注册表 `index.json`，把 `builtin: true` 的条目下载并校验到 `out/plugins/`；应用首次启动再播种到数据根的 `plugins/installed/`。
- 本地开发要看到内置插件，先执行一次 `pnpm plugins:sync`（需要网络，可走代理）：`out/plugins/` 只由该脚本写入（每次同步前清空），`pnpm build` 与 `pnpm dev` 都不动它。
- macOS 构建使用 **Developer ID Application** 证书签名（hardened runtime + 公证）：本地构建从钥匙串自动发现证书（需先在 Apple Developer 创建并导入）；CI 由 Release workflow 从 secrets 导入 p12。fuses 会改写二进制，electron-builder 在改写后重签。签名是应用内静默更新的前置条件——Squirrel.Mac 校验更新包与当前应用的代码签名一致（Team ID），ad-hoc 签名的副本无法静默升级到签名版本。
- 安装包在对应平台（或 CI）上产出：macOS 主机默认只产 mac 目标，Windows / Linux 目标交给 CI。

发版由 tag 触发：tag 版本必须与 `package.json` 的 `version` 一致，否则打包任务直接失败。

```bash
# 1. 改 package.json 的 version，与将要打的 tag 保持一致
git commit -am "chore: release v0.1.1"
git push

# 2. 打 tag 并推送，触发 Release workflow
git tag v0.1.1
git push origin v0.1.1
```

workflow 先跑与 CI 相同的 verify（typecheck / lint / build），并判定 SDK 是否需要发布；通过后在 macOS（单 job 双架构，产出唯一 `latest-mac.yml` 更新 feed）、Windows、Linux 上分别打包，汇总为该 tag 的 GitHub Release。tag 名含 `-`（如 `v0.2.0-beta.1`）时标记为 prerelease，不会成为下载按钮指向的最新版本。合入 workflow 后推首个 tag 即产出首个 Release。

SDK 只在其 `packages/sdk` 版本高于 npm 已发布版本时发布；没有变化的 release 跳过 npm。发布判定、版本规则与 npm 认证（Trusted Publisher，无需 token）见 [RELEASING.md](RELEASING.md)。

macOS 构建需要仓库配置以下 Actions secrets：

| Secret                        | 说明                                             |
| ----------------------------- | ------------------------------------------------ |
| `MAC_CERTIFICATE`             | Developer ID Application 证书 p12 的 base64 编码 |
| `MAC_CERT_PASSWORD`           | 导出 p12 时设置的密码                            |
| `APPLE_ID`                    | Apple ID 邮箱（公证用）                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com 生成的 App 专用密码（公证用）  |
| `APPLE_TEAM_ID`               | Team ID（公证用）                                |

SDK 发布走 npm Trusted Publisher（OIDC），不需要 `NPM_TOKEN` 之类的 token secret。

CI 在打包之后会验证签名身份（Developer ID Application）与 Gatekeeper 放行结果：公证凭据缺失或签名回退为 ad-hoc 时构建直接失败，避免发出无法静默更新的安装包。本地手动打包不注入公证凭据，因此只完成签名、不做公证。

macOS 安装版的应用内更新为静默替换：electron-updater（Squirrel.Mac）下载 zip 后，退出应用时自动替换，或在设置页点「重启并安装」立即更新。`latest-mac.yml` 随 Release 发布，是更新 feed；首次从 ad-hoc 版本升级需手动 dmg 安装一次签名版。

### 7.5 技术栈

- [Electron 44](https://www.electronjs.org/)
- [electron-vite 6](https://electron-vite.org/)（构建）
- [electron-builder 26](https://www.electron.build/)（打包）
- [Vite 8](https://vite.dev/)
- [TypeScript 6](https://www.typescriptlang.org/)
- [oxlint](https://oxc.rs/) / [oxfmt](https://oxc.rs/)
