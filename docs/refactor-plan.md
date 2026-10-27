# 重构方案：AppHost 三级作用域与列表框架

> 目标设计见 [`architecture.md`](./architecture.md)。此文件是迁移计划，评审通过后执行，完成后删除。
>
> 原则：按目标结构直接重构，不做兼容性修补；旧通道、旧类型、旧组件在对应阶段删除，不保留双轨。

## 一、目标与非目标

**目标**

1. 主进程引入 `AppHost`：统一管理 App / Workspace 两级作用域；Session 交给 pi。
2. 工作区切换 = 销毁旧 `WorkspaceScope` + 创建新实例；会话切换 = 委托 pi + 重绑事件桥。
3. 列表结构由 App 定义，数据由 Workspace 解析，渲染层用 `ListHost` 按规范渲染。
4. 渲染层只消费 `AppSnapshot`，只发 `AppCommand`；事件带 scope / epoch。
5. 资源、页面、技能按 App / Workspace / Session 分级加载，会话只做激活。
6. 所有资源目录在 App 私有数据目录，不读写 `~/.pi` 或真实工作区 `.pi`；WorkStudio 与 pi CLI 完全独立。
7. WorkStudio 插件统一为 zip + 本地路径，收口到 `<appData>/plugins`。

**非目标**

- 不改视觉与交互细节。
- 不改 URA 的编解码、绑定优先级与写队列规则。
- 不引入前端全局 store；渲染层仍按切片持有投影。
- 不做旧插件 API 的长期兼容；`registerCollection` 直接替换为 `registerList`。
- 不支持项目 `.pi` / 用户 `~/.pi` 的资源发现；不引入 project trust。
- 不支持 WorkStudio 插件的 npm/git 远程安装；远程只接受 zip。

## 二、目标结构

**资源目录（全部 App 私有）**

| 级别      | 目录                                                                                                | 内容                          |
| --------- | --------------------------------------------------------------------------------------------------- | ----------------------------- |
| App       | `<appData>/agent/extensions`、`skills`、`settings.json`、`npm/`、`git/`                             | 全局安装的扩展 / 技能 / Pi 包 |
| Workspace | `<appData>/agent/ws/<id>/.pi/extensions`、`.pi/skills`、`.pi/settings.json`、`.pi/npm/`、`.pi/git/` | 工作区级资源与策略            |
| Session   | 无目录                                                                                              | 只持激活集与资源快照          |

- 不读写 `~/.pi`，也不读写真实工作区 `.pi`；安装即信任，不引入 project trust。
- 资源装载的 project root 是 App 私有 `.pi`；会话 cwd 仍是真实工作区。`createAgentSessionServices` 会把 loader cwd 绑到 session cwd，不能直接复用；改用 `createAgentSession({ cwd, resourceLoader, ... })` 或自定义 services。
- 资源安装默认 App 级；工作区 `.pi` 目录是可选的 App 私有工作区资源根，不指向真实项目。
- 工作区只做 `enabledExtensions` / `disabledExtensions` / `defaultSkills` 策略；会话只做 skills 激活。

```text
src/
├── shared/
│   ├── app.ts                 # AppSnapshot / AppCommand / AppEvent / Scope / 各 Slice
│   ├── lists.ts               # ListDefinition / ListFieldSpec / ListItem / ListSnapshot
│   ├── views.ts               # ViewEntry / ViewState / ViewType（从 types.ts 拆出）
│   └── channels.ts            # app:sync / app:cmd / app:snapshot / app:event
├── main/
│   ├── app/
│   │   ├── app-host.ts        # 组合根：作用域、路由、快照、事件
│   │   ├── app-scope.ts       # 应用级：模型 / 凭证 / 插件 / Pi 包 / 全局设置 / 系统视图
│   │   ├── workspace-manager.ts
│   │   ├── workspace-scope.ts # 工作区级：URA / 列表 / 视图 / UI / 页面会话 / 会话索引
│   │   ├── session-adapter.ts # 会话级：pi 适配、事件桥、UI 上下文
│   │   ├── snapshot.ts        # AppSnapshot 构建
│   │   ├── router.ts          # scope-aware 命令路由
│   │   └── lists/
│   │       ├── list-registry.ts
│   │       ├── list-service.ts
│   │       └── builtins/      # docs / web / temp / sessions / plugins / settings
│   ├── capabilities/
│   │   ├── webview/
│   │   │   ├── system-views.ts  # 助手 / 浮层 / 捕获层（App 级）
│   │   │   └── tab-views.ts     # 标签集合（Workspace 级）
│   │   ├── settings/
│   │   └── browser/
│   ├── plugins/
│   │   ├── registry.ts        # registry.md 解析 / 写回
│   │   ├── installed.ts       # installed.json
│   │   ├── zip-service.ts     # 下载 / 校验 / 解压 / 原子替换
│   │   └── loader.ts          # 扫描 installed/ + local
│   ├── ura/
│   ├── agent/
│   ├── harness/
│   └── state/                 # 逐步并入 workspace-scope / app-scope
├── preload/
│   └── app.ts                 # 统一桥：sync / cmd / onEvent / onSnapshot
└── renderer/
    ├── api/app.ts
    ├── state/
    │   ├── app-store.ts
    │   ├── workspace-store.ts
    │   ├── ui-store.ts
    │   └── session-store.ts
    └── components/
        ├── list-host/         # GroupHeader / RowRenderer / ActionBar / states
        └── sidebar/           # 只保留导航与 ListHost 装配
```

## 三、数据结构（实现契约）

以 `architecture.md` §二 为准，新增 / 替换以下类型：

### 3.1 `shared/app.ts`

```ts
type Scope = 'app' | 'workspace' | 'session' | 'ui';

interface AppSnapshot {
  app: AppSlice;
  workspaces: WorkspaceMeta[];
  workspace: WorkspaceSlice;
  ui: WorkspaceUiSlice;
  session: SessionSlice;
  seq: number;
  workspaceEpoch: number;
  sessionEpoch: number;
}

interface AppCommand<T = unknown> {
  scope: Scope;
  action: string;
  payload?: T;
}

interface AppEvent<T = unknown> {
  scope: Scope;
  epoch: number;
  seq: number;
  event: T;
}
```

`AppSlice` / `WorkspaceSlice` / `WorkspaceUiSlice` / `SessionSlice` / `WorkspaceMeta` / `SessionMeta` / `ViewEntry` 等字段见 `architecture.md` §2.2。

### 3.2 `shared/lists.ts`

`ListDefinition` / `ListFieldSpec` / `ListActionSpec` / `ListItem` / `ListGroup` / `ListSnapshot`，字段见 `architecture.md` §2.4。

### 3.3 删除 / 替换

| 旧类型                                                  | 处理                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `UiState`                                               | 拆成 `WorkspaceUiSlice` + `SessionSlice.context`；`selectedSkills` 移入 session |
| `ShellSnapshot`                                         | 拆成 `AppSnapshot.workspace + ui`                                               |
| `WorkSyncResult`                                        | 由 `AppSnapshot` 替代                                                           |
| `CollectionView` / `CollectionGroup` / `CollectionItem` | 由 `ListDefinition` / `ListSnapshot` 替代                                       |
| `ws:sync / ws:state / ws:view / ws:event / ws:ui`       | 由 `app:sync / app:snapshot / app:event / app:cmd` 替代                         |
| `useDocumentsStore`                                     | 由列表快照 + `ListHost` 替代                                                    |
| `useOpenTabs`                                           | 由 `workspace.views` + `session` 切片替代                                       |

## 四、阶段

### Phase 0 · 基线

- `pnpm typecheck` / `pnpm lint`；记录已有 warning。
- 打基线 commit，后续每阶段一个 commit。
- 确认 dev 启动、工作区切换、打开 docx/插件/网页、会话切换的现状。

**退出**：基线可运行，warning 清单固定。

### Phase 1 · 契约与 AppHost 骨架

**新增**

- `shared/app.ts`、`shared/lists.ts`、`shared/views.ts`、`channels.ts` 新通道。
- `main/app/app-host.ts`：包装现有服务，先不改行为。
- `main/app/snapshot.ts`：从现有服务拼出 `AppSnapshot`。
- `main/app/router.ts`：`AppCommand` → 旧 `invoke` 的临时适配。
- `preload/app.ts`、`renderer/api/app.ts`。

**修改**

- `main/index.ts`：由 `AppHost` 接管组合；旧 channel 暂留，转发到 AppHost。
- `main/command/router.ts`：命令实现保留，入口改为 `AppHost.dispatch`。
- 渲染层启动：`app.sync` 生成旧 store 的投影（临时适配）。

**退出**

- 应用行为不变；`AppSnapshot` 已包含 app / workspaces / workspace / ui / session。
- 新通道可用，旧通道仍工作。

**Commit**：`refactor: introduce app host and scope contracts`

### Phase 2 · WorkspaceScope

**新增**

- `workspace-manager.ts`：工作区列表、当前工作区、切换事务。
- `workspace-scope.ts`：持有 UiState、标签视图、列表、工作区资源根与启用策略、页面会话、写会话、会话索引、浏览器策略。
- `system-views.ts` / `tab-views.ts`：拆 `ViewHost`，系统视图归 App，标签视图归 Workspace。

**修改**

- `main/state/ui-state.ts`：由 WorkspaceScope 持有；加载 / flush / dispose 跟随工作区。
- `main/capabilities/webview/host.ts`：拆成系统视图 + 标签视图。
- `main/ura/page-sessions.ts`、`sessions.ts`：由 WorkspaceScope 创建与销毁。
- `main/index.ts`：`switchWorkspace` 走 `WorkspaceManager`。
- `AppSnapshot.workspace` / `ui` 由新 WorkspaceScope 生成。

**退出**

- 切换工作区：旧标签、旧页面会话、旧写会话、旧列表全部消失；系统视图保留。
- 工作区列表与 App 级状态不重建。
- `workspaceEpoch` 生效，旧事件被丢弃。

**Commit**：`refactor: scope workspace state and views`

### Phase 3 · SessionAdapter

**新增**

- `session-adapter.ts`：包装 pi runtime；`switchSession` 委托 pi；EventBridge attach/detach；UI 上下文重绑。
- 会话级技能激活表：`sessionPath -> activeSkills`。

**修改**

- `main/agent/agent-host.ts`：保留 pi runtime 与命令，移除对 workspace / UI 的所有权；资源只从 App 私有目录装载。
- `main/agent/event-bridge.ts`：事件带 scope / epoch。
- 扩展集合在会话创建 / 工作区切换时装配；会话内切换扩展需要重启会话，不做热开关。
- `main/harness/skills.ts`：删除全局 `active`，激活集由 SessionAdapter 提供。
- `main/agent/session-index.ts`：归 WorkspaceScope；`sessions` 列表使用。
- `AppSnapshot.session` 由 SessionAdapter 生成。

**退出**

- 两个会话可各自持有不同技能激活；切换会话只换 `session` 切片。
- 会话切换不重建工作区、不重载资源。
- 旧 session 事件被 epoch 丢弃。

**Commit**：`refactor: delegate session switching to pi`

### Phase 4 · 列表框架

**新增**

- `main/app/lists/list-registry.ts`：定义注册（内置 + 插件）。
- `main/app/lists/list-service.ts`：定义 + provider + UI 覆盖 → `ListSnapshot`。
- `main/app/lists/builtins/*`：docs / web / temp / sessions / plugins / settings。
- 插件 API：`registerList({ definition, provider })`。

**修改 / 删除**

- `main/ura/collections.ts`、`collections/docs.ts`、`browser/features.ts` 的 `registerCollection` → `registerList`。
- `main/ura/registry.ts`、`plugins/host.ts`：新注册面；旧 collection 注册删除。
- `main/command/router.ts`：`lists.snapshot` / `lists.activate` / `lists.action`。
- `renderer/components/sidebar/*`：删 `DocumentList` / `GroupRow` / `OpenItem` / `PluginList` / `SettingsList` 的写死结构；改为 `ListHost` + 行模板。
- `renderer/state/documents.ts`、`openTabs.ts`：删除；列表数据只来自 `workspace.lists`。
- `shared/ura.ts`：删除 `CollectionView` 系类型。

**退出**

- 内置列表全部走同一注册表；Sidebar 没有 docs / web / 临时网页分支。
- 测试插件 `registerList` 后无需改渲染层即可出现分组、行、动作。
- 工作区切换后列表数据整体替换，定义保留。

**Commit**：`refactor: move sidebar list structure into app`

### Phase 5 · 插件 zip 管理

**新增**

- `main/plugins/registry.ts`：`registry.md` 解析 / 写回；zip 链接 + `#sha256=` + 本地路径。
- `main/plugins/installed.ts`：`installed.json`（source → id / version / hash）。
- `main/plugins/zip-service.ts`：下载、sha256 校验、解压、manifest 校验、staging、原子替换。
- `main/plugins/loader.ts`：扫描 `installed/` + 本地路径 + 内置；`apiVersion` 兼容检查。
- `shared/app.ts`：`PluginSourceInfo`；`PluginInfo` 增加 source / hash / apiVersion。

**修改**

- `main/plugins/service.ts`：删除 npm/git 安装、`node_modules` 项目、npm CLI 调用；改为 zip-service + registry。
- `main/plugins/packages.ts`：扫描根改为 `installed/`；读取 `workstudio` 清单与 `apiVersion`。
- `main/plugins/host.ts`：扫描本地路径 + `installed/` + 内置。
- `main/command/router.ts`：插件来源 / 安装 / 卸载命令走新服务。
- 设置 → 插件页：来源清单、版本 / hash、安装状态、诊断。
- 安装 / 卸载下次启动生效；无自动更新。

**删除**

- npm/git 来源解析、`ensureProject`、`dependencyNames`、`findNewPlugin`、`runNpm`。
- `<appData>/plugins/node_modules` 与 npm 项目文件。
- 旧 `plugins.md` 位置与 npm/git 清单行。

**退出**

- `registry.md` 只接受 zip URL（带 sha256）与本地路径。
- 安装：下载 → 校验 → 解压 → 原子替换 `installed/<id>`；卸载只删 `installed/<id>`。
- 本地路径原地加载；Pi 资源不受影响。
- 远程缺 sha256、hash 不匹配、路径穿越、多插件 zip 全部拒绝。

**Commit**：`refactor: install plugins from zip artifacts`

### Phase 6 · 渲染层作用域

**新增**

- `renderer/state/app-store.ts`、`workspace-store.ts`、`ui-store.ts`、`session-store.ts`。
- epoch 过滤：事件进入 store 前比对 `workspaceEpoch` / `sessionEpoch`。

**修改 / 删除**

- `renderer/main.tsx` / `App.tsx`：`app.sync` 后按 app → workspace → ui → session 水合。
- `shell.ts` / `tabs.ts` / `tabService.ts` / `conversation.ts` / `plugins.ts` / `agentConfig.ts`：改为读切片。
- 删除旧 `ws:*` 订阅与 `WorkSyncResult` 适配。
- 命令统一走 `AppCommand`；页面数据面与视图总线保留。

**退出**

- 工作区切换只替换 workspace / ui / session store；App store 不变。
- 会话切换只替换 session store。
- 旧 epoch 事件不进入 store；重连用 `app.sync` 重建。

**Commit**：`refactor: hydrate renderer from scoped snapshots`

### Phase 7 · 清理与验收

- 删除旧 channel、旧类型、旧 collection、旧 sidebar 组件、`useDocumentsStore`、`useOpenTabs`。
- 更新代码注释中的架构章节引用。
- 跑验收矩阵与 dev 冒烟；截图核对侧栏 / 标签 / 列表 / 切换。

**Commit**：`refactor: remove legacy state and list paths`

## 五、验收矩阵

| 场景          | 步骤                                           | 期望                                                           |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| 工作区切换    | 开 docx、插件页、网页，编辑脏态后切换          | 旧标签 / 页面会话 / 写草稿消失；系统视图保留；新工作区列表加载 |
| App 常驻      | 切换工作区                                     | 模型、凭证、插件、Pi 包、全局设置不变                          |
| 会话切换      | A 选技能 x，B 选技能 y，来回切                 | 各自提示使用各自技能；消息 / 流式不串                          |
| 会话列表      | 打开多个会话标签                               | 列表来自 `sessions` 定义；切换只改激活                         |
| 插件列表      | 测试插件注册 `mail` 分组                       | 无需改渲染层出现分组、行、动作                                 |
| 列表动作      | 打开 / 关闭 / 固定 / 插件动作                  | 统一走 `lists.action`，主进程执行                              |
| 事件纪元      | 切工作区后旧事件到达                           | 渲染层丢弃，不污染新状态                                       |
| 重连          | 刷新渲染层                                     | `app.sync` 重建，旧事件无效                                    |
| 资源分级      | App 装插件、Workspace 放文件、Session 激活技能 | 加载在正确级别，会话只激活                                     |
| 插件 zip 安装 | 清单加 zip URL + sha256 后安装                 | 解压到 `installed/<id>`；重启后注册成功                        |
| 插件完整性    | 篡改 zip 或漏写 sha256                         | 拒绝安装，不写入 `installed/`                                  |
| 插件本地开发  | 清单加 `./plugins/csv`                         | 原地加载，不复制                                               |
| 插件更新      | 清单换成新版本 zip                             | 重新安装覆盖；不自动更新                                       |
| 资源隔离      | 在真实工作区放 `.pi/extensions` / `.pi/skills` | 不加载、不执行；资源只来自 App 私有目录                        |
| pi CLI 独立   | 检查 `~/.pi` 与项目 `.pi`                      | WorkStudio 不读不写；pi 只作为库运行                           |
| 页面释放      | 关闭标签 / 切工作区                            | 页面会话与写会话释放                                           |
| 列表无特例    | 全局搜索 docs / web / temp 写死                | 只在主进程列表定义中出现                                       |

## 六、破坏性变更

- IPC：`ws:sync` / `ws:state` / `ws:view` / `ws:event` / `ws:ui` 删除，改 `app:sync` / `app:snapshot` / `app:event` / `app:cmd`。
- 快照：`UiState` / `ShellSnapshot` / `WorkSyncResult` 删除，改 `AppSnapshot` 切片。
- 插件 API：`registerCollection` 删除，改 `registerList({ definition, provider })`；内置 provider 同步迁移。
- 渲染层：`useDocumentsStore` / `useOpenTabs` / Sidebar 写死列表删除。
- 视图：`ViewHost` 拆为系统视图 + 标签视图；标签视图随工作区销毁。
- 资源边界：`~/.pi` 与真实工作区 `.pi` 不再读取；资源目录全部迁到 App 私有目录；移除 project trust。
- 插件安装：npm/git 来源删除，只保留 zip + 本地路径；`plugins.md` 改为 `<appData>/plugins/registry.md`；`plugins/node_modules` 删除。

## 七、风险与回滚

- **风险**：一次改 IPC 与快照，渲染层会短暂不可用。Phase 1 保留旧通道适配，Phase 6 再删。
- **风险**：列表 provider 慢或返回大列表。`ListService` 增加 limit / 分页字段，先按现有 500 条上限。
- **风险**：pi 会话切换与事件桥耦合。Phase 3 只做适配，不改 pi 内部。
- **回滚**：每阶段独立 commit；Phase 6 前旧通道仍可用，可单独回退渲染层阶段。

## 八、执行规则

1. 每阶段先跑 `pnpm typecheck`、`pnpm lint`，再提交。
2. 每阶段只做该阶段的结构变化；不夹带视觉调整。
3. 旧代码在 Phase 7 统一删除；之前允许临时适配，但不允许新增依赖旧结构的功能。
4. 每阶段结束更新本文件状态与 `architecture.md` 的偏差。
