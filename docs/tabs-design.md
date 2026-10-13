# 资源面板 Tabs 设计（tabs-design.md）

> 定位：S3 中栏的「打开集合」= 一组 tab。**一个 tab 是一个统一封装**：
> 视图（view）只是它的内部组成，生命周期（状态机）与 tab 语义（标题/固定/脏态/顺序）
> 都收敛在同一个 Tab 记录上。**不存在独立的 View 概念对外**。
>
> 宿主层由 `TabService` 承载（主进程原生视图实现 / 开发期 mock 实现同一契约），
> 渲染层只消费 TabEntry 镜像。Electron 侧的硬事实（对象模型 / 事件表 / API 行为）
> 引用 `view-lifecycle.md`，不重复。

---

## 一、设计原则

1. **单一封装**：一个 Tab 封装 view、生命周期与 tab 语义；view 是内部组成，不外泄句柄。
2. **单一事实源**：Tab 记录是权威数据面，渲染层 TabEntry 只是它的镜像（DTO）。
3. **收敛点唯一**：状态机的全部迁移只发生在一条 Tab 记录内；投递、守卫、重载合并均由封装内部处理。
4. **命令幂等**：open / close / reload / activate 可重复调用；非法状态一律 no-op。
5. **分层清晰**：宿主层（TabService）管视图机制；渲染层管集合 UI 语义（顺序 / 固定 / 脏态）与呈现。
6. **可恢复**：持久化走 `tabKey` 稳定键（固定 / 顺序 / 激活），运行期句柄不落盘。

---

## 二、对象模型（统一封装）

### 2.1 一个 Tab 记录

```
Tab（TabService 内部 record）
├─ tabId      ：运行时唯一 id（= 渲染层 instanceId；按它发所有命令）
├─ tabKey     ：稳定键（跨重启持久化：固定/顺序/激活）
├─ view       ：WebContentsView（tab 的内部组成，不外泄）
├─ state      ：状态机（§三；tab 的生命周期）
├─ meta       ：kind / extensionId / title / url / document / plugin / temporary …
└─ ui         ：pinned / dirty / order（tab 语义；渲染层拥有）
```

要点：

- **view 在 Tab 里面**：创建、挂载、bounds、激活、销毁都由 tab 封装内部完成；
  对外没有 `view` / `webContents` 句柄（拿不到就不会误用）。
- **一条 Tab 记录 = 一个收敛点**：壳（视图容器）、体（页面）、进程三者的寿命都对齐在它上面；
  状态机的全部迁移只发生在这条记录内。
- 渲染层拿到的是 **TabEntry（Tab 的 DTO 形状）**，不是第二个对象：

```ts
type TabKind = 'document' | 'plugin' | 'builtin' | 'browser';
type ViewState =
  | 'creating'
  | 'loading'
  | 'ready'
  | 'contentDelivered'
  | 'reloading'
  | 'error'
  | 'destroyed';

interface TabEntry {
  tabKey: string; // 稳定键（§2.2）
  instanceId: string; // = tabId，运行时句柄
  kind: TabKind;
  extensionId: string; // 渲染器/内置视图 id（def 匹配、声明式动作）
  title: string; // tab 短标题（文档 = 文件名）
  url: string; // 地址栏地址（相对路径 / app:// scheme）
  state: ViewState; // 状态机投影（spinner / 门控用）
  dirty: boolean; // 编辑器未保存（tab 琥珀点）
  pinned: boolean; // 固定（排在未固定之前，批量关闭跳过）
  temporary?: boolean; // raw 且不在归档名单（临时网页，随标签存亡）
  document?: DocumentMeta;
  plugin?: PluginInfo;
  raw?: boolean;
  interactiveElements?: boolean;
  layout?: string; // 声明式动作状态（html-editor layout-switch）
}
```

### 2.2 稳定键 tabKey

主进程运行期 id（`tabId`/`instanceId`）重启即失效；持久化必须用稳定键：

```
document:<documentId>            // 文档（同文档复用实例）
plugin:<pluginId>:<extensionId>  // 插件 config 页 / 首页
builtin:<viewId>                 // 内置 DOM 视图（如 session-manager）
browser:<url>                    // raw 网页视图（同 URL 复用）
```

### 2.3 四类 tab（同一状态机，不同配置）

| kind     | 稳定键                 | 就绪信号                                  | 备注                             |
| -------- | ---------------------- | ----------------------------------------- | -------------------------------- |
| document | documentId             | 握手 `data:loaded`（有 preload 的插件页） | 兜底 text-editor；同文档复用     |
| plugin   | pluginId + extensionId | 同上                                      | config 页 / 首页；label = 插件名 |
| builtin  | viewId                 | 打开即 `ready`（无 view，状态机退化）     | 渲染层直接承载的 DOM 页面        |
| browser  | url                    | `did-finish-load` 即 `ready`              | raw；`temporary` 随标签存亡      |

---

## 三、Tab 生命周期（状态机）

### 3.1 状态机

| 状态               | 含义                    | 允许的操作                      |
| ------------------ | ----------------------- | ------------------------------- |
| `creating`         | 对象已建、view 未挂载   | open                            |
| `loading`          | 导航中                  | 投递排队、reload（合并）、close |
| `ready`            | 已握手（`data:loaded`） | 投递直发、reload、close         |
| `contentDelivered` | 已投递内容              | 同 ready                        |
| `reloading`        | 重载中                  | 投递排队、close                 |
| `error`            | 加载失败 / 进程崩       | reload、close；进入时清空旧队列 |
| `destroyed`        | 已关闭（终态）          | 全部 no-op                      |

```
  Tab 状态机

                                                                                    ┌───v
   ┌──────────┐             ┌──────────┐data:loaded     ┌──────────┐deliver()   ┌──────────────────┐
   │ creating │── open() ──>│ loading  │───────────────>│  ready   │───────────>│ contentDelivered │
   └──────────┘             └──────────┘                └──────────┘            └──────────────────┘
                                 │   ▲                       │   ▲                        │ reload()
                                 │   │ nav                   │   │ data:loaded            │
                                 │   │                       │   │                        │
                           fail  │   │             reload()  │   │                        │
                                 │   │                       │   │                        │
                                 ▼   │                       ▼   │  ▼─────────────────────┘
                            ┌─────────────┐             ┌─────────────┐
                                           ──reload()──>
                            │    error    │             │  reloading  │
                                           <──fail──────
                            └─────────────┘             └─────────────┘

                              ┌───>┐
                              │    │ memory-eviction（自环：只置 needsReload）
                            ┌────────────────┐ close() / wc destroyed ┌─────────────┐
                            │ any live state │......................>│  destroyed  │
                            └────────────────┘                       └─────────────┘
```

- `nav` = `did-start-navigation`（只认主框架）；`fail` = `did-fail-load`（主框架、且非 `-3`）
  或导致进程消失的 `render-process-gone`
- `any live state` = 任何存活状态；`close()`（任何状态）与页面 `destroyed` 都收敛到 `destroyed`
- `memory-eviction` 不进 `error`：状态不变（自环），只置 `needsReload`，激活时补一次 reload
- `dom-ready` / `did-finish-load` **不改状态**（资源就绪 ≠ 能收消息），只有握手 `data:loaded` 算 `ready`

### 3.2 事件 → 迁移（收敛点全在 per-tab 状态机内）

| 事件（来自哪一层）                            | 迁移                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| `did-start-navigation`（页面，主框架）        | 任意 → `loading`；`loading`/`reloading` 下忽略（重载不降级） |
| `did-finish-load` / `dom-ready`（页面）       | 不改状态（等握手）                                           |
| `data:loaded`（preload → IPC）                | 任意 → `ready`（幂等）→ 冲刷排队内容                         |
| `did-fail-load` / `did-fail-provisional-load` | 过滤 `-3` 与非主框架 → `error`                               |
| `render-process-gone` crashed/oom/killed      | 清队列 → `error` + `needsReload`                             |
| `render-process-gone` memory-eviction         | 不改状态，只置 `needsReload`                                 |
| `render-process-gone` clean-exit              | 忽略（close 的伴生）                                         |
| `destroyed`（页面）                           | → `destroyed`（幂等，清记录）                                |
| `bounds-changed`（视图容器）                  | 不进状态机（布局）                                           |
| `before-input-event`（app 层）                | 按 `wc.id → tabId` 路由到 `reload()`，不直改状态             |

### 3.3 六条纪律

1. **监听先于导航**：`open()` 内先 bind → attach → loadURL（缓存命中加载极快，晚一步丢事件）；
2. **命令第一行守卫**：未 open / 已 close / 页面已销毁 → no-op（页面死后除 `isDestroyed()` 全抛）；
3. **过滤 `-3` 与子框架失败**：`-3` = 被取消，不是失败；
4. **`memory-eviction` 不动状态**：只置 `needsReload`，点回来才重载；
5. **close 幂等**：解绑 → 摘壳 → 关页成对执行，重复调用 no-op；
6. **投递门控**：非 `ready` 一律排队，绝不在未就绪时 `send`。

### 3.4 状态 → tab 呈现映射

| 状态                           | 地址栏       | tab                                                      |
| ------------------------------ | ------------ | -------------------------------------------------------- |
| creating / loading / reloading | spinner      | 正常（标题可先显示）                                     |
| ready / contentDelivered       | 无 spinner   | 正常                                                     |
| error                          | 停止 spinner | **错误徽标**（红色圆点 + tooltip「加载失败，点击重试」） |
| destroyed                      | —            | 已在 close 时移除                                        |

其余 tab 徽标：`dirty` 琥珀点；固定 tab 显示 Pin 图标。

### 3.5 与 8 大问题的对应（收敛点）

`view-lifecycle.md §1.2` 的 8 项问题，在统一 Tab 封装内的落点：

| #   | 问题（现象）                                          | 收敛点                                                    |
| --- | ----------------------------------------------------- | --------------------------------------------------------- |
| 1   | 关闭 tab 后异步回调触发 → `Object has been destroyed` | 纪律 2：命令第一行 `#alive(tab)` 守卫                     |
| 2   | 视图容器在不在树上无权威来源                          | Tab 记录持有 `mounted`；`setActive` 一条命令完成挂载/移出 |
| 3   | 页面销毁后方法全抛                                    | 纪律 2（同上）；`isDestroyed()` 之外不触碰                |
| 4   | `send()` fire-and-forget，未挂监听的消息丢失          | 纪律 6：非 `ready` 排队，`ready` 冲刷                     |
| 5   | 连点刷新，`-3` 被当失败 → 状态机误入 error            | 纪律 3 + `loading/reloading` 下 reload 合并               |
| 6   | 渲染进程崩溃连坐（多 tab 一起黑）                     | `render-process-gone` → 该 tab `error` + `needsReload`    |
| 7   | 渲染进程被淘汰（memory-eviction）无预警               | 纪律 4：不动状态、置 `needsReload`、激活时补 reload       |
| 8   | 原生视图恒盖 DOM，DOM 弹层被挡                        | tab 右键菜单走原生 `Menu.popup`（popupMenu 协议）         |

---

## 四、集合语义与操作

### 4.1 不变量（任何实现必须满足）

1. **激活 ∈ 打开**：`activeId ≠ null ⇒ activeId ∈ tabs`；
2. **激活唯一**：同一时刻至多一个激活；
3. **同 key 复用**：同一 `tabKey` 的 open 转 activate，绝不重复开 tab；
4. **顺序即数组顺序**：固定项稳定排在未固定项之前（两组内部各自保持数组顺序）；
5. **批量关闭跳过固定项**（单独 close 允许关闭固定项，浏览器语义）；
6. **关闭激活 tab**：优先激活**右邻**，无右邻取左邻，都没有 → `activeId = null`（空态）。

### 4.2 命令表（统一入口，按 tabId 寻址）

| 命令                        | 语义                                      | 说明                                  |
| --------------------------- | ----------------------------------------- | ------------------------------------- |
| `open(options)`             | 建 tab（内部建 view → 挂载 → 导航）       | 同 `tabKey` 转 activate；重复调用幂等 |
| `activate(tabId)`           | 置为激活                                  | 非激活 view 移出视图树（层级保证）    |
| `close(tabId)`              | 关闭：内部解绑 → 摘壳 → 关页 → 选相邻激活 | 幂等                                  |
| `closeOthers(anchorId)`     | 关闭除锚点外的未固定 tab                  | 固定项保留                            |
| `closeToLeft/Right(anchor)` | 关闭锚点左/右侧未固定 tab                 | 固定项保留                            |
| `closeAll()`                | 关闭全部**未固定** tab                    | 固定项保留；空态                      |
| `togglePin(tabId)`          | 固定/取消固定，重排到对应分组             | 数组重排，位置确定                    |
| `moveTab(fromId, toId)`     | 拖拽排序                                  | 仅同组内换位，跨组需先 togglePin      |
| `deliver(tabId, payload)`   | 内容投递：就绪直发，未就绪排队            | 返回是否直发；任意状态可调            |
| `reload(tabId)`             | 重载；`loading/reloading` 下合并          | 可重复调                              |
| `setBounds(tabId, bounds)`  | 位置尺寸（布局，不进状态机）              | 可重复调                              |
| `snapshot()`                | TabEntry 快照（状态机投影）               | 渲染层唯一数据面                      |

### 4.3 与 Sidebar / 地址栏的同源投影

- Sidebar「展开项」= `tabs.filter(kind=document)`（当前项 = 激活 tab 的 documentId）；
- 「临时网页」分组 = `tabs.filter(kind=browser && temporary)`；
- TitleBar 地址栏 = 激活 tab 的 `url` + `state`（spinner 只在此出现）+ 声明式动作；
- S4 会话 tabs 数据源不同（`openPaths`），**共用 TabsBar 组件、不共用集合**。

---

## 五、持久化与恢复

- **不落盘**：`instanceId`、`state`、页面内容（瞬态 / 后端数据）。
- **落盘**（`ui-state.json`，按工作区隔离）：`tabs.pinned: tabKey[]`、`tabs.order: tabKey[]`、`tabs.activeKey`。
  UI 字段新增：`openTabs?: { pinned: string[]; order: string[]; activeKey: string | null }`。
- **恢复流程**：`TabService` 按上次会话重建 tab（或惰性重建）→ 渲染层收到 TabEntry 列表
  → 按 `tabKey` 匹配持久化的 order/pinned/active → 对齐；匹配不到的 key 直接丢弃。

---

## 六、模块与组件边界

| 模块                                                           | 职责                                                                                                | 不做什么                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `TabService`（宿主层：主进程原生视图 / 开发期 mock，同一契约） | **统一封装本体**：Tab 记录（view + 状态机 + meta）、open/close/activate/bounds/reload/deliver、快照 | 不管 tab 顺序/固定等 UI 语义（由渲染层 ui 态承载） |
| `state/tabs.ts`（渲染层镜像）                                  | TabEntry 集合 + UI 语义：顺序/固定/脏态/关闭族命令；单向接收快照                                    | 不建 view、不投递、不读总线                        |
| `components/resource/TabsBar.tsx`                              | 纯视图：滚动、激活标、脏点/错误标、Pin、拖拽排序、右键菜单                                          | 不直接调宿主；只回调                               |
| `components/resource/ResourcePane.tsx`                         | 组装：tabs → TabsBar 属性；内容区按内置视图注册表分流                                               | 不写集合逻辑                                       |
| `components/resource/ExtensionView.tsx`                        | 占位 div 丈量 + setBounds；mock 预览                                                                | 不关心 tab 语义                                    |

---

## 七、验收要点

集合（tabs 域，纯逻辑可单测）：

1. 同 key 二次 open → 不新增、转激活；不同 key → 追加并激活；
2. 关闭激活 tab → 激活右邻；无右邻 → 左邻；空 → null；
3. closeOthers/Left/Right/All 跳过固定项；单独 close 允许关闭固定项；
4. togglePin 后顺序确定（固定组在前，组内序不变）；moveTab 仅同组可换位；
5. 状态 patch 不改变顺序/固定；快照对齐后不变量仍成立。

生命周期（对齐 `view-lifecycle.md` §3.2，封装内部）：

6. `loading` 期投递排队、`ready` 后按序冲刷；重复 reload 合并；
7. `did-fail-load(-3)` 不迁移；主框架失败 → `error`；`memory-eviction` 不动状态；
8. close 幂等；close 后所有命令 no-op；`view:destroyed` 外部销毁能对齐集合（tab 消失、激活重选）。
