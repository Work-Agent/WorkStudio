# WorkAgent 页面设计文档（UI · 结构 · 状态 · 交互）

---

---

## 一、页面结构总览

### 1.1 统一中栏架构（单一工作台页面）

应用为**单一工作台页面 + 应用壳层**（TitleBar + 三栏工作台）：

```
┌─────────────────────────────────────────────────┐
│ S1 TitleBar：[☰ 工作区▾]…[地址栏]…[💬 ☀ 📦 W]   │
├──────────┬────────────────────────┬─────────────┤
│ S2 左栏   │ S3 中栏（统一 tab 流）  │ S4 AI 会话   │
│ 分组导航/ │ 文档实例 · 插件 config  │（可收起）    │
│ 二级列表/ │                      │             │
│ 插件列表  │   WebContentsView）    │             │
└──────────┴────────────────────────┴─────────────┘
```

- **统一中栏**：所有「打开的东西」= 中栏一个 tab = 一个扩展实例（WebContentsView）——
  文档实例与插件 config 页共用同一实例模型与同一 tab 流，全部内容经中栏 tab 打开。
  - **新窗口收编**：视图内 `target="_blank"` / `window.open` 不弹独立窗口，一律转为
    中栏新标签（同 URL 复用已有实例）——桌面里只有一套标签体系。
  - **可交互元素开关**：网页面板地址栏在后退/前进之后有「显示/隐藏可交互元素」按钮
    （默认关闭；开启后页面元素带 ref 标记 + overlay），导航后自动复位。
- **配置即插件（系统功能完全插件化）**：系统功能各自成插件（与其他插件同机制：
  manifest `config` 贡献点），从 Sidebar 插件列表打开：
  - `model-config` 模型设置（供应商/模型 CRUD、默认模型与思考档位、API Key）
  - 文件型插件同样有 config 页（介绍 + 自身偏好）：html-editor、milkdown-editor、
    text-editor 等——插件双 html 模式：文件操作页 + config 设置页。
  - **每个插件必有 config 页**（介绍 + 设置），插件列表行点击即打开。
- **TitleBar 右侧动作**：AI 开关 / 主题 / 插件列表（切 Sidebar plugins 形态）/ W 徽标；
  工作区选择在 TitleBar 左段。
- **三栏布局**：左栏 Sidebar（可收起为图标列）+ 中栏资源面板 + 右栏 AI 助手
  （SplitView 统一部件；左栏收起态/AI 开关全局共享）。

### 1.2 工作台的三栏结构

```
┌─────────────────────────────────────────────────────┐
│ S1 应用壳层 TitleBar（WCO 集成式·简化）               │
│ [原生控制区] [☰ 工作区▾]…[地址栏：url + 按类型动作]… [💬 ☀ 📦 W]│
├──────────┬──────────────────────────┬───────────────┤
│ S2 左栏   │ S3 中栏 资源面板          │ S4 右栏 会话   │
│ ┌────────┐ ┌─ Tabs（title）────────┐ │ ┌─ 会话 Tabs ─┐│
│ ├────────┤ ├─ 扩展视图内容区        │ │ ├─ 消息流     ││
│ 主列表    │ │                        │ │ ├─ Token 统计 ││
│ /二级列表 │ │                        │ │ ├─ 输入区     ││
│ /插件列表 │ │                        │ │ └─────────────││
└──────────┴──────────────────────────┴───────────────┘
     ↑ 拖拽边界    ↑ 路径行=地址栏  ↑ toggle/工作区在 TitleBar   S4 可整栏收起
```

### 1.3 结构部分清单

| 编号 | 部分              | 所在位置         | 职责一句话                                                                                                                      | 归属状态域                   |
| ---- | ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| S1   | 应用壳层 TitleBar | 常驻             | 主题/AI 开关/插件入口 + 左段（Sidebar 收起/展开 toggle + 工作区下拉）+ 中央资源地址栏（url + spinner + 按类型动作，浏览器语义） | 壳层（数据消费自资源面板域） |
| S2   | 左栏 Sidebar      | 工作台           | 资源分组导航 + 二级列表 + 插件列表（列表形态；工作区下拉在 TitleBar 左段）                                                      | 左栏视图态（数据消费自各域） |
| S3   | 资源面板          | 工作台           | 统一 tab 流：打开的文档/插件 config 页的 tabs 管理与内容承载                                                                    | 资源面板域                   |
| S4   | 会话面板          | 工作台           | AI 对话全生命周期                                                                                                               | 会话域 + 输入域              |
| —    | 配置面板          | S3 中栏 tab 之一 | 模型等配置（各插件 config 页，见 §七）                                                                                          | 配置域                       |

---

## 二、领域数据模型（实体字典）

先立实体，后立状态——状态只是实体的「投影」。

### 2.1 实体关系

```
Workspace 1─* Document（按 source 分组：local / business）
Session    1─* Message（JSONL 落盘，按会话隔离）
Document   1─1 ViewInstance（同文档去重复用实例）
Plugin     1─* ExtensionDef（视图渲染器）/ 1─1 配置页 / 1─1 首页 / 1─* Skill / 1─* Tool
Session    1─* ApprovalRequest（规则门触发，挂起等待裁决）
```

### 2.2 实体定义

**Session（会话）** —— 一次业务任务的对话载体

| 字段        | 说明                                                     |
| ----------- | -------------------------------------------------------- |
| `path`      | 会话唯一标识（JSONL 文件地址）                           |
| `name`      | 会话标题（首条用户消息生成）                             |
| `preview`   | 最后一条助手消息预览                                     |
| `createdAt` | 创建时间                                                 |
| 消息流      | 按会话隔离加载（user/assistant × thinking/tool/text 块） |
| `tokens`    | input/output 统计                                        |

**Document（资源文档）** —— URA 统一资源模型（侧边栏与文档打开的通用货币）

| 字段     | 说明                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`     | 唯一键（资源地址稳定拼接，对渲染层不透明）                                                                           |
| `title`  | **展示标题**（文件名）→ tabs、侧边栏                                                                                 |
| `path`   | 命名空间内定位地址（对用户透明）                                                                                     |
| `url`    | **地址栏地址**（TitleBar 中央）：本地文档 = 工作区**相对路径**；应用内资源 = `app://` scheme（business/plugin）      |
| `ext`    | 文件扩展名（不含点，小写）→ 决定由哪个扩展视图渲染（data 轨资源 ext='schema'）                                       |
| `type`   | 三轨：`content`（全文可读）/ `data`（仅 schema，走工具查询）/ `snapshot`（网页存证，全文可读）                       |
| `source` | `local` / `web` / `business` → 决定侧边栏分组；web 再按 `group`（域）分组成「网站资料」组                            |
| `group`  | URA 分组（`{ id, title }`；web = 域，title = 站点主标题）——分组行 / 设置页域列表用（图标经 `documents_groups` 单发） |
| `schema` | data 类资源的字段描述（data 轨唯一可注入形态）                                                                       |

**ViewInstance（视图实例）** —— 中栏一个打开的 tab（**统一模型**：文档实例、插件
config 页、插件首页共用）

| 字段                                        | 说明                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `instanceId`                                | 实例唯一标识                                                                                                                |
| `extensionId`                               | 使用的扩展渲染器 id（文档按 `ext` 匹配，无匹配兜底 text-editor；config 页 = `<pluginId>-config`；首页 = `<pluginId>-home`） |
| `label`                                     | tab 标题（文档 = 文件名；config 页 = 插件名）                                                                               |
| `url`                                       | TitleBar 中央地址栏地址                                                                                                     |
| `documentId`                                | 绑定的文档 id（非文档实例——config/首页——为 null）                                                                           |
| `pluginId` / `visible` / `loaded`           | 所属插件 / 是否置前 / webview 是否已报 `data:loaded`（就绪事实，渲染层重载后恢复依据）                                      |
| `raw` / `interactiveElements` / `temporary` | raw 网页视图 / 可交互元素（ref 标记 + overlay）是否上屏（导航后复位） / 名单外临时网页（不落盘，随标签页存亡）              |

**Plugin / Skill** —— 插件（清单 + 扩展视图 + 配置页 + 首页 + 技能 + 工具）、技能（会话输入可勾选）。
插件运行时信息 `PluginInfo` 含贡献点计数（extension/skill/tool）与 `hasConfig`/`hasHome` 标志。

**AgentConfig（运行配置）** —— provider / modelId / thinkingLevel / workspacePath（+ apiKey 仅提交不回传）。存储三文件分权：供应商/模型目录 = models.json（pi 同构）；默认模型与思考档位 = config.json；key = auth.json。

---

## 三、S1 应用壳层（TitleBar，常驻）

**职责**：偏好开关（主题 / AI 栏 / 插件列表）+ **左段**（Sidebar 收起/展开 toggle +
工作区下拉——收起 Sidebar 后仍可切工作区）+ **中央资源地址栏**
（浏览器语义：激活资源的 url + 加载 spinner + 按类型动作组——通用「刷新」+ 声明式贡献

- raw 网页导航动作；无激活资源时退化为纯拖拽区）+ WCO 拖拽区。
  配置的入口在 S2（插件列表）。

**原生控制按钮适配（三键 / 红绿灯）**：窗口控制按钮由系统原生绘制、位置由平台决定——
macOS 红绿灯在左；Windows/Linux（titleBarOverlay）三键在右，但 Linux 各 DE 可配置在左。
故 TitleBar **不写死留白**：**适配先判平台**——WCO 几何只在 Windows/Linux 使用
（`navigator.windowControlsOverlay.getTitlebarAreaRect()` 反推两侧留白写
`--titlebar-inset-left/right`，`geometrychange` / `resize` 重算）；macOS 红绿灯不经覆盖层，
直接平台兜底值；Win/Linux 无几何信息时同样回落兜底（几何/配色单一事实源 =
`shared/titlebar.ts`）。`.titlebar` 消费变量。
Windows/Linux 覆盖层配色随主题经 `setTitleBarOverlay` 收敛（见 §3.4），
高度与 `.titlebar` 同源（40px；Linux DE 若强制更大高度，渲染层跟随其 rect.height）。

### 3.1 状态

| 状态               | 类型                                                                         | 初始值          | 持久化 | 说明                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`            | `light` \| `dark`                                                            | `dark`          | ✅     | 主题模式                                                                                                                                        |
| `aiOpen`           | `boolean`                                                                    | `true`          | ✅     | 会话面板是否显示（停靠或浮动）                                                                                                                  |
| `aiFloating`       | `boolean`                                                                    | `false`         | ✅     | 会话面板浮动形态：`false` = 停靠右栏 / `true` = 独立浮层（可拖拽/缩放）                                                                         |
| `sidebarView`      | `main` \| `sessions` \| `docs` \| `data` \| `web` \| `plugins` \| `settings` | `main`          | ✅     | 左栏形态（web = 域二级列表；plugins = 插件列表，TitleBar 📦 toggle；settings = 设置列表）                                                       |
| `sidebarCollapsed` | `boolean`                                                                    | `false`         | ✅     | 左栏 Sidebar 是否收起（TitleBar toggle；收起 = 图标列：分组/打开项保留展开，仅去文字留图标，固定宽 56px；工作区下拉/toggle 仍在 TitleBar 常驻） |
| `paneWidths`       | `{ left, right }`                                                            | 左 240 / 右 420 | ✅     | 三栏宽度（左/右栏；中栏弹性）：拖拽松手提交（一次拖拽一次写），重启恢复                                                                         |

**派生态（不存储）**：`sidebarView` 直接驱动左栏内容形态。

### 3.2 操作与状态变迁

| 操作              | 触发事件                        | 方法                                               | 状态变迁                                              | 跨部分联动                                                                                                                                                                 |
| ----------------- | ------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打开/关闭插件列表 | TitleBar 📦 图标                | `setUiState({ sidebarView })`（toggle 语义）       | `sidebarView ← plugins`（当前为 plugins 则回 `main`） | 左栏切插件列表；图标靛蓝高亮切换                                                                                                                                           |
| 切换主题          | 点击 ☀/🌙                       | `toggleTheme()`                                    | `theme ← 取反`                                        | 全局 CSS 变量；扩展视图收到 `event:theme` 广播；主进程 `nativeTheme.themeSource` 同步（见 §3.4 主题传播链）                                                                |
| 开关 AI 栏        | 点击 💬                         | `toggleAi()`                                       | `aiOpen ← 取反`                                       | 面板整栏显示/收起（显示时恢复上次形态）；TitleBar 图标高亮变化                                                                                                             |
| 浮动/停靠 AI 栏   | 面板内浮动按钮 / 浮层标题栏停靠 | `setUiState({ aiFloating })`                       | `aiFloating ← 取反`                                   | 停靠右栏 ⇄ 独立浮层（浮层可拖拽/缩放；几何运行期保留、不落盘）                                                                                                             |
| 切换左栏形态      | 点击分组行/返回键（S2 内）      | `setSidebarView(view)`                             | `sidebarView ← 目标值`                                | 左栏内容整体替换                                                                                                                                                           |
| 选择工作区        | TitleBar 左段工作区下拉 → 选择  | `pickWorkspace()` → `configure({ workspacePath })` | 后端配置更新                                          | 文档列表重扫；会话目录切换；技能刷新                                                                                                                                       |
| 收起/展开 Sidebar | 点击 TitleBar 左段 toggle       | `toggleSidebar()`                                  | `sidebarCollapsed ← 取反`                             | 左栏切为图标列（分组/打开项保留展开、去文字，仅图标）/恢复完整列表（SplitView `leftCollapsed`，展开态可拖拽、收起态固定宽 56px 不可拖拽）；toggle 图标在 close/open 间切换 |
| 调整栏宽          | 拖拽 1px 边界                   | `onWidthsChange(w)`                                | `paneWidths` 更新（松手提交）                         | 中栏内 webview 同步 bounds                                                                                                                                                 |
| 拖拽收起左栏      | 拖拽左边界到 <140px 松手        | `onLeftCollapseChange(true)`                       | `sidebarCollapsed ← true`                             | 左栏自动收起为图标列（拖宽松手则保持展开并夹回合法范围；收起态可向外拖拽展开）                                                                                             |

### 3.3 本部分规则

- TitleBar 图标按钮（AI/主题/插件）的**打开态 = 图标本身靛蓝高亮**，非背景块。
- **原生控制按钮留白不写死**：三键/红绿灯位置由平台决定（macOS 左 / Windows 右 /
  Linux 视 DE），**适配先判平台**——WCO 几何只用于 Windows/Linux，反推 `--titlebar-inset-*`；
  macOS 或无 WCO 几何时回落平台兜底；标题栏高度同源（`--titlebar-height`）。
- 插件按钮有 toggle 语义：插件列表形态下再点回主列表（与 AI 栏开关同一交互范式）。
- **AI 面板三态**：停靠右栏（默认）/ 独立浮层（标题栏拖拽移动、右下角缩放，**移动/缩放范围夹取在中栏资源面板内**——不越出资源面板、不遮挡侧栏与标题栏；浮层尺寸随面板缩放） / 收起。浮层开关随 `aiFloating` 持久化；浮层几何为瞬时态不落盘。
- 工作区下拉项：当前目录（全路径展示）/ 选择目录…（系统对话框）/ 在系统文件管理器中打开。

### 3.4 主题传播链（全局亮暗收敛的唯一入口）

真相源 = 主进程 `UiStateService`（`theme` 持久化于 ui-state.json）。启动/切换/工作区挂载时收敛 `nativeTheme.themeSource ← theme`，之后一切亮暗派生自原生层：

| 消费方                         | 机制                                                      | 说明                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 渲染层（主窗口）               | `uiState.theme` 镜像 + SolidJS class                      | 应用自身 UI（Tailwind dark: 前缀）                                                                                                                     |
| 插件页 / 扩展视图              | `event:theme` 总线广播（双向：ready 时主动推送）          | 页面 `data-theme` 属性 + `color-scheme` 声明（控件/滚动条配色）                                                                                        |
| raw 网页视图（浏览器面板）     | `nativeTheme` → webContents `prefers-color-scheme`        | **适配了亮暗的站点（GitHub/MDN 等）自动跟随应用主题；未适配的站点原样渲染**（媒体查询是告知不是强制，与 Chrome/Safari 行为一致，不做 force-dark 强改） |
| 原生控件（右键菜单等）         | `nativeTheme.themeSource`                                 | Electron 原生 UI 自动配色，无需传参（菜单弹出侧不再单独接主题）                                                                                        |
| WCO 覆盖层（Win/Linux 三键区） | `win.setTitleBarOverlay`（UiStateService 主题收敛时写入） | 覆盖层底色/符号色与 TitleBar 同色（建窗给初值，切换主题实时更新；不跟随会留一条与标题栏脱节的色块）                                                    |
| raw 视图背景                   | `view.setBackgroundColor`（跟随 nativeTheme 实时更新）    | 加载期防白闪（暗色主题下视口底色为暗；页面绘制后归页面自己）                                                                                           |

---

## 四、S2 左栏 Sidebar（工作台）

**职责**：全部资源与会话的**浏览与导航入口**（含插件列表）；同时是
「已打开项」的聚拢展示区。本部分**不拥有独立数据**——消费会话域/资源域的投影，
仅左栏形态是自有状态。

### 4.1 消费的数据模型

- `documents`（全部 Document，按 source 分组：本地文档 / 网站资料；业务数据为 data 轨，
  不在 Sidebar 列出——数据经工具查询）
- `groups`（`UraGroupInfo[]`，分组的 favicon/计数数据面——资源行图标 + 域分组头）
- `openDocs` + `activeDocId`（资源面板域 → 文档分组下方展开项；当前项高亮真相源）
- `plugins`（插件列表形态：`PluginInfo[]`，含贡献点计数）

（会话列表不在本部分：归设置域「会话管理」页，消费 `sessions` / `sessionDomains` / `activePath`。）

### 4.2 状态

| 状态            | 类型                                                                         | 说明                                                                                                             | 持久化    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| `sidebarView`   | `main` \| `sessions` \| `docs` \| `data` \| `web` \| `plugins` \| `settings` | 左栏形态（壳层拥有，本部分读写）                                                                                 | ✅        |
| `sidebarDomain` | `string \| null`                                                             | web 二级列表当前选中的域（`sidebarView='web'` 时生效）；`__temporary__` = 「临时网页」分组（打开的名单外标签页） | ✅        |
| `pinnedGroups`  | `Record<组, boolean>`                                                        | 分组顶置                                                                                                         | ❌ 内存态 |

### 4.3 操作与状态变迁

| 操作                  | 触发事件               | 方法                                         | 状态变迁                | 跨部分联动                                           |
| --------------------- | ---------------------- | -------------------------------------------- | ----------------------- | ---------------------------------------------------- |
| 进入分组（资源/web）  | 点击分组标题行         | `setSidebarView(组)`                         | `sidebarView` 变化      | 左栏切二级列表                                       |
| 返回主列表            | 点击返回键             | `setSidebarView('main')`                     | `sidebarView ← main`    | —                                                    |
| 顶置分组              | 点击 Pin               | `togglePin(组)`                              | `pinnedGroups[组]` 取反 | 分组重排序                                           |
| 打开文档              | 点击文档行             | `openDocument(docId)`（资源面板域命令）      | 资源面板域变迁          | 见 §5.3                                              |
| 打开会话              | 会话管理页点击行       | `openSession(path)`（会话域命令）            | 会话域变迁              | 见 §6.3                                              |
| 删除会话              | 会话管理页行内删除     | `deleteSession(path)`（会话域命令）          | 会话域变迁              | 真删除（数据消失）；streaming 中显示停止按钮而非删除 |
| 关闭标签（助手 tabs） | 展开项 hover × 按钮    | `closeSessionTab(path)`（会话域命令）        | 会话域变迁              | 关闭 ≠ 删除（openPaths 移除，数据保留）              |
| 折叠/展开会话域分组   | 会话管理页点击分组头   | 本地 state                                   | 无（纯视图态）          | 分组头 = favicon + 站点标题 + 计数                   |
| 打开插件 config 页    | 插件列表形态点击插件行 | `openPluginConfig(plugin)`（资源面板域命令） | 资源面板域变迁          | 见 §5.3（tabs +1 + 面板自动展开）                    |

### 4.4 本部分规则

- **打开 ≠ 当前**（双状态语义，展开项渲染规则）：
  - **被打开**（多值）：与对应面板 tabs 一致的全部打开项，**全部展开在分组下方**（背景卡片聚拢）；
  - **当前**（每面板唯一）：展开项中仅当前项带左缘靛蓝竖条 + 头像高亮；
  - 点击任一展开项 → 切换为当前（不新增打开）。
- 文档分组的展开项 = `openDocs` 全集（含非当前）；会话列表不在此承载。
- 分组副行显示 `N 项 + 最近时间`；hover 高亮必须带圆角。
- **资源分组数据源驱动**：无文档的数据源整组隐藏，
  与「装/卸插件 = 注册/注销能力组」语义一致；会话为常驻导航组。
- **网站资料分组（一个域 = 一个系统，子域各自成组）**：每个域一个分组行——图标 = 域 favicon
  （缺失/加载失败回退 Globe），标题 = 站点主标题（回退域名），副行 = 该域页数；
  点击 → 记录 `sidebarDomain` 并切 web 二级列表（**只列该域 L3 页面快照**）。
  **域列表与 L2 站点导览（`<域>.md`）的唯一展示地是浏览器插件设置页**——
  资源面板不承载域列表、也不承载导览正文（导览是自动生成的派生只读文件）。
- **「临时网页」分组（名单外的打开标签页）**：域名不在归档白名单内的网页**不落盘**
  （不建目录 / 不写快照），打开后只作为侧边栏一个分组存在——图标 Hourglass、
  副行 = 打开标签数；点击 → 切 web 二级列表，**只列当前打开的这些标签页**
  （点击行 = 激活对应标签）；关掉全部标签分组即消失（分组归属随域名导航实时重算）。
- **会话列表 = 设置域「会话管理」页（中栏 tab，与模型设置同一打开管道）**：
  入口在设置列表（TitleBar ⚙️ →「会话管理」），Sidebar 不承载会话导航；
  列表按「访问过的域」分组——组头 = 域 favicon
  （缺失回退 Globe）+ 站点主标题 + 域名 + 会话数，可折叠；未关联域的会话归入
  「其他会话」组。关联真相源 = `session_domains`（浏览器捕获命中，turn 边界落定）。
  页内搜索过滤（标题 / 预览）；行点击 = 切换当前会话（页面保留）；行内删除 = 真删除；
  streaming 行显示停止按钮。
- **Sidebar 无标题栏**：工作区下拉在 TitleBar 左段（见 §三 / WorkspaceSelect，
  随 Sidebar 收起/展开 toggle 常驻，收起后仍可切工作区）。列表主体从左上直接开始。
- **插件列表形态（plugins）**：插件行 = Package 图标（青色系）+ 名称 + v 版本 +
  贡献点计数 meta（N 视图 · N Skill · N 工具，无则显示插件 id）；
  **行点击 = 打开该插件自己的 config 页**（配置即插件——介绍 + 设置一体，无「设置」后缀）。
- **收起态（图标列）**：`sidebarCollapsed=true` 时左栏收为固定窄列（56px，不可拖拽），
  **分组保持展开、打开的文件/会话仍在——仅去文字留图标**（不整栏隐藏；隐藏的是文字块，
  行高/内边距/卡片结构与展开态完全一致，收起前后图标不跳动）：
  - 每个分组头只显彩色图标（保留色系 + 当前分组左缘靛蓝高亮），不显标题/计数文字；
  - 分组下方的打开项（文档）仍列出，仅显图标（当前项带高亮），保留「被打开≠当前」语义；
  - **图标用资源自身图标**：会话 = 首字母头像（与展开态一致）；文档 = FileText 图标；不换用通用图标；
  - 图标全部水平居中于窄列中轴（图标统一 32px，列表体 `px-1` + 行 `px-2` = 56px 恰好居中）；
  - 点击分组图标 → 导航到该分组（`sidebarView` 切换，保持收起态）；点击打开项图标 →
    打开该资源并激活；展开经 TitleBar toggle 或拖拽左边界向外；
  - 工作区下拉/toggle 常驻 TitleBar 左段，不随左栏收起而隐藏。

---

## 五、S3 中栏 资源面板（统一 tab 流，ResourcePane）

> tabs 管理能力与视图生命周期的实现设计见 **`docs/tabs-design.md`**（集合语义 / 状态机 / 持久化 / 组件边界）。

**职责**：打开的资源视图的 tabs 管理与内容承载——**统一模型**：文档实例、插件
config 页与插件首页全部走同一通道（同一实例表、同一 TabsBar、同一地址栏规则）。
路径展示在 S1 TitleBar 中央地址栏。

### 5.1 数据模型

tabs 数据源 = `ViewInstance[]`（统一模型）；TitleBar 地址栏数据源 = 激活实例派生
`activeDisplayUrl()`（文档 = `doc.url`，非文档实例 = `app://plugin/<pluginId>`）；
内容区 = 按 `extensionId` 路由的隔离 WebContentsView（ExtensionView 占位 div 丈量
bounds，主进程移动/缩放原生视图）。实例生命周期由 InstanceFSM 管理（见 `fsm-architecture.md`）。

### 5.2 状态

| 状态               | 类型                        | 初始值           | 持久化                                 | 说明                                                                                                                                     |
| ------------------ | --------------------------- | ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `instances`        | `ViewInstance[]`            | 主进程实例表同步 | ❌（不落盘；渲染层重载可从主进程恢复） | 打开的视图实例（tabs 数据源，含 config 页/首页）                                                                                         |
| `activeInstanceId` | `id \| null`                | 恢复最后一个     | ❌                                     | 当前激活 tab（面板唯一）                                                                                                                 |
| `panelCollapsed`   | `boolean`                   | `false`          | ✅                                     | 面板收起态（打开文档/插件页自动复位 false；暂无 UI 收起入口）                                                                            |
| `docByInstance`    | `Map<instId, DocumentMeta>` | 空               | ❌                                     | 实例 → 文档元数据（含 title/url；非文档实例无条目）                                                                                      |
| `pluginByInstance` | `Map<instId, PluginInfo>`   | 空               | ❌                                     | 实例 → 所属插件（config/首页实例）                                                                                                       |
| `instanceStates`   | `Map<id, InstanceState>`    | 空               | ❌ 派生                                | InstanceFSM 状态镜像（creating/loading/ready/contentDelivered/reloading/error；驱动 spinner 与内容投递门控，详见 `fsm-architecture.md`） |
| `dirtyDocIds`      | `Set<docId>`                | 空               | ❌                                     | 编辑器脏文档集合（`action:dirty` 总线事件驱动 → tab 脏点）                                                                               |
| `defs`             | `ExtensionDef[]`            | 启动加载         | ❌                                     | 扩展定义缓存（渲染器匹配 + 声明式壳层动作元数据）                                                                                        |
| `previewContent`   | `DocumentContent \| null`   | `null`           | ❌                                     | 当前文档内容缓存                                                                                                                         |

### 5.3 操作与状态变迁

| 操作               | 触发事件                                     | 方法                                                  | 状态变迁                                                                                                                                                                                                             | 跨部分联动                                                                        |
| ------------------ | -------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 打开文档           | 侧边栏点击                                   | `openDocument(docId)`                                 | `panelCollapsed ← false`；按 `ext` 匹配扩展（无匹配兜底 `text-editor`）→ 已有同文档实例则**复用**并激活；否则创建实例追加 `instances`；`activeInstanceId ← 该实例`；内容经 FSM 投递（非 ready 自动排队，不发进黑洞） | 侧边栏对应分组展开项 +1（背景卡片出现）                                           |
| 激活 tab           | 点击 tab                                     | `selectInstance(instId)`                              | `activeInstanceId ← instId`；webview 置于最前                                                                                                                                                                        | 侧边栏「当前」标记随 activeDocId 变化；地址栏 url 切换                            |
| 关闭 tab           | 点击 tab ×                                   | `closeTab(instId)`                                    | `instances` 移除 + webview 销毁；若关的是活跃 → 激活相邻（列表末项），无剩余 → 空态                                                                                                                                  | 侧边栏展开项 −1；最后一个关闭时分组卡片消失、地址栏隐藏                           |
| 批量关闭           | tab 右键菜单（关闭其他/左侧/右侧/全部）      | `closeOthers / closeToLeft / closeToRight / closeAll` | 按锚点位置批量销毁（逐个走 closeInstance 清理链），结束后锚点为当前                                                                                                                                                  | 侧边栏展开项随减；菜单项按位置条件禁用（锚点已最左则「关闭左侧」灰）              |
| 刷新内容           | TitleBar 地址栏刷新按钮 / Cmd+R / F5         | `reloadInstance(instId)`                              | **真实 reload**：就绪态复位（地址栏 spinner）→ `webContents.reload` → webview 重发 `data:loaded` → 内容缓存清除重发（无白屏）。快捷键在主进程全局拦截并路由到当前激活视图（连按去重，绝不重载整个渲染层）            | —                                                                                 |
| 收起面板           | —（暂无 UI 入口）                            | `toggle()`                                            | `panelCollapsed` 取反                                                                                                                                                                                                | 面板隐藏（实例保留）；打开文档/插件页自动复位展开                                 |
| 编辑脏态           | webview 编辑器（`action:dirty` 总线事件）    | —（纯镜像）                                           | `dirtyDocIds` 增删该 docId                                                                                                                                                                                           | tab 出现/消失琥珀色脏点                                                           |
| 保存内容           | webview 内编辑保存（`action:save` 总线事件） | `saveContent(docId, content)`                         | 调后端写盘；文档元数据更新时间刷新；脏点清除                                                                                                                                                                         | 侧边栏该文档时间戳更新                                                            |
| 打开插件 config 页 | S2 插件列表行点击                            | `openPluginConfig(plugin)`                            | `panelCollapsed ← false`；打开/复用 `<pluginId>-config` 实例（`documentId=null`，label = 插件名）                                                                                                                    | tabs +1 + TitleBar 地址栏 `app://plugin/<id>`；插件信息经 `data:content` 下发视图 |
| 打开插件首页       | manifest 声明 `hasHome` 的插件               | `openPluginHome(plugin)`                              | `<pluginId>-home` 约定扩展实例                                                                                                                                                                                       | 同上                                                                              |

### 5.4 系统事件驱动

| 事件                           | 来源                                                               | 状态变迁                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data:loaded`                  | webview 报告就绪（仅启动时发一次）                                 | InstanceFSM `LOADED`（幂等收敛：任何状态 → ready；TitleBar 地址栏 spinner 消失）。**就绪是主进程事实非事件时机：建槽/恢复从 `loaded` 标志直接进 ready（竞速完成时事件可能已丢）——spinner 不得永挂** |
| `view:reloading`               | 主进程 reload() 统一编排点（按钮 / 快捷键拦截 / 自重启兜底均经此） | FSM `RELOAD`（清投递记录）+ 从后端重拉重投（磁盘内容为权威，不依赖渲染层缓存）                                                                                                                      |
| `view:destroyed`               | 主进程实例销毁（外部 destroy 绕过 store）                          | instances/docByInstance/激活态随主进程事实收敛对齐（地址栏/ tabs 不残留）                                                                                                                           |
| `action:dirty` / `action:save` | webview 编辑器                                                     | `dirtyDocIds` 增删 / 后端写盘（见操作表）                                                                                                                                                           |
| `event:layout`                 | webview 回报布局态（声明式动作协议的回报通道）                     | TitleBar 布局切换按钮图标/激活态同步（见 §5.5 动作协议）                                                                                                                                            |
| 文档列表刷新                   | 后端 `onRefresh`（文件系统变化 / agent 写盘）                      | 文档列表重载；**已打开且非脏的本地 html 文档自动重拉重投**（外部变更即时刷新预览；脏实例不覆盖，保护未保存手改）                                                                                    |

### 5.5 本部分规则

- **tabs 只显示 `title`（短标题，居中制）；TitleBar 中央地址栏强制显示激活资源 `url`（分层地址）**——语义分工（浏览器地址栏语义）。
- **中栏统一标签栏（TabsBar 规范）**：h-9 居中制 tab + 左右滚动按钮 + 激活顶部 0.5px 靛蓝标 + 可选图标/badge + 可选关闭钮（hover 显示）。**打开集合语义**：文档实例 / 插件 config 页**混排同一集合**——点击左栏行才打开、关闭钮移出集合，初始为空，绝不显示未打开项；无实例时整个 TabsBar 不渲染（内容区显示空态引导）。
- **tab 右键菜单（原生 `Menu.popup()`，主进程 MenuPopupService，官方 context-menu 教程范式）**：菜单项 = 关闭 / 关闭其他 / 关闭全部 / 关闭左侧 / 关闭右侧（顺序即此）；按回调存在才显示、按锚点位置条件禁用（已最左则「关闭左侧」灰显）。零窗口管理、即时弹出、键盘导航免费；不传坐标（默认鼠标位置弹出，见 docs/native-context-menu.md）；代价 = OS 主题非像素级。
- **地址分层（两类来源两种形态）**：
  - **本地文档**：工作区**相对路径**（如 `docs/report.md`）——禁止绝对路径（泄露目录结构且无意义）；
  - **网站资料**：中栏 tab 只承载 L3 页面快照（snapshot 查看器）；域列表与 L2 站点导览
    （`RESOURCES/<域>.md`）的唯一展示地是浏览器插件设置页——资源面板不出域名列表；
  - **应用内资源**：`app://` scheme（仿浏览器快照风格）——`app://business/<对象id>` / `app://plugin/<插件id>`（config 页/首页）。
- 加载 spinner **只允许出现在 TitleBar 地址栏**，禁止进 tabs。
- **任何激活实例（含插件 config 页）必须在 TitleBar 地址栏显示地址**；无激活实例（全部关闭/空态）时地址栏整体隐藏（退化为纯拖拽区）。
- 同文档重复打开 = 复用实例（tabs 不重复）。
- **脏态规则**：tab 内琥珀圆点 = 未保存（`dirtyDocIds`）；脏实例不参与外部变更自动重投；关闭实例时同步清理脏标记。
- **地址栏动作区 = 通用动作 + 声明式贡献**（`actionsFor()`）：
  - 通用：所有类型注册「刷新」（真实 reload，见操作表）；
  - 声明式：插件在 manifest `extensions[].titlebarActions` 声明动作 id，仅激活实例所属扩展声明的动作出现（动作集随激活实例切换，非激活类型的动作不出现）。
    动作协议：指令 `action:<id>` 下发视图，视图回报 `event:<id>` 同步状态（乐观更新 + 回报对齐）。
    当前注册：html-editor 的 `layout-switch`（布局三态循环 预览→分屏→源码；图标随当前态切换，非预览态高亮）。
  - raw 网页面板：后退 / 前进 / 可交互元素开关（`url-action-toggle-refs`——默认关闭，开启后页面带 ref 标记 + overlay，导航后复位；见 §1.1）。
- **渲染器兜底**：无扩展名匹配的文档统一落 `text-editor`（备忘录式纯文本编辑，零依赖）——不硬编码任何专门插件 id。
- **全域滚动条统一（主窗口 + 插件 webview）**：**标准属性方案**（CSS Scrollbars 标准，Tailwind 官方文档站 / Chrome 121+ / Firefox 同款写法）——
  `scrollbar-width: thin` + `scrollbar-color: <thumb> transparent`，即交回平台**原生 overlay 滚动条**：
  不占布局（条浮在内容上）、滚动时浮现/停手隐去、hover 加粗加深由平台负责 —— 这是「透明、不笨重」的官方解，
  尤其适合浮动下拉框（自写常显实心条会把浮层填得很重）。
  取值（半透明是硬要求）：亮色黑系 `rgb(24 24 27 / .35)` / 暗色白系 `rgb(255 255 255 / .4)`。
  实现：**单一事实源 `src/shared/styles/scrollbar.css`**——主窗口渲染层由 `index.css` @import 内联；
  插件扩展视图由 **extension-preload 于文档创建期注入**（`<style id="wa-scrollbar-css">`，早于首帧、
  每次导航自动重跑；插件页 HTML 不得再自写滚动条样式）。
  互斥硬约束：**一旦页面里出现任何自定义 `::-webkit-scrollbar` 规则，Chrome 会忽略标准属性** ——
  两者只能活一套；另外 `scrollbar-width` 在 Chromium 下只在“实际声明它的元素”上生效（子元素解析出的是 used value），
  故 token 放 `:root`、生效属性放 `*`（token 写进 `*` 会把值钉死，主题覆盖失效）。
  备选（常显 + 自定义 hover 三态）：VS Code 官方 token（dark `#797979@.4` → hover `#646464@.7` → active `#BFBFBF@.4`；light `#646464@.4 / #646464@.7 / #000000@.6`）。
- **滚动面清单（哪些地方受此规范管）**：主窗口 DOM 的一切滚动面（三栏面板/消息流/代码块
  `pre`/输入框 `textarea`/tabs（设计上隐藏）/对话框 + 全部浮层，含 Portal 到 body 的下拉
  ——Portal 不是独立文档，同一套规则直接生效）；所有插件扩展视图（config 页 + 查看/编辑器页，
  含其内部下拉）。
- **不受管的滚动条（有意）**：① raw 网页视图（浏览器面板）与 html-editor 的沙箱预览 iframe——
  都是**外部/用户内容**，滚动条归内容自己（与 §3.4「不强改站点」同一原则；
  且 CSS 注入作用于主文档，不进入子 frame，技术上也不通过）；
  ② 原生控件（`<select>` 下拉、右键 `Menu.popup()`）——OS 绘制，无 CSS 接口。

---

## 六、S4 右栏 AI 助手面板（工作台）

**职责**：AI 对话全生命周期——多会话 tabs、消息流渲染、输入与技能选择、执行控制。

### 6.1 数据模型

会话 tabs 数据源 = `openPaths`（**不是**全部会话）；消息流 = `messagesBySession`（按会话隔离）。

### 6.2 状态

| 状态                | 类型                   | 初始值                           | 持久化      | 说明                                                                                     |
| ------------------- | ---------------------- | -------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `sessions`          | `Session[]`            | 后端加载                         | 后端持久    | **全部**会话（列表数据源）                                                               |
| `openPaths`         | `path[]`               | `[]`（启动为空则自动选首个会话） | ✅ 现场恢复 | **已打开为标签**的会话（tabs 数据源；重启恢复，无效 path 过滤、activePath 回退到有效项） |
| `activePath`        | `path \| null`         | 持久恢复                         | ✅          | 当前会话；`null` = 新任务态                                                              |
| `messagesBySession` | `Map<path, Message[]>` | 空                               | 后端 JSONL  | 每会话消息流（懒加载，已加载缓存）                                                       |
| `streamingSessions` | `Set<path>`            | 空                               | ❌ 派生     | 正在执行的会话（PromptFSM 状态驱动）                                                     |
| `tokensBySession`   | `Map<path, Tokens>`    | 空                               | ❌          | 每会话 token 统计                                                                        |

**核心区分：`sessions`（全部）vs `openPaths`（已打开）** ——「关闭标签 ≠ 删除数据」的基础。

**输入域（`state/input.ts` store，本面板内嵌）**：

| 状态                | 类型                | 持久化 | 说明                                                                        |
| ------------------- | ------------------- | ------ | --------------------------------------------------------------------------- |
| `text`              | `string`            | ❌     | 草稿（消息体 / slash 命令行）；输入区关闭重开不丢                           |
| `acItems` / `acIdx` | 补全候选 / 高亮索引 | ❌     | slash 补全目录 = builtin + get_commands 合流；仅 `/` 开头且命令名输入中唤起 |
| `chatInputExpanded` | `boolean`           | ✅     | 输入框展开态（展开 = 占面板下半）                                           |
| `selectedSkills`    | `Skill[]`           | ✅     | 随 prompt 提交的技能（选择器入口：选中数 > 0 时靛蓝高亮）                   |
| `agentStatus`       | 配置快照            | 后端   | configured / modelId / thinkingLevel（未配置 → 输入区禁用 + 警示）          |

slash 命令目录（builtin + get_commands）与宿主拦截归 `state/commands.ts`（命令域），与输入草稿解耦。

### 6.3 用户操作与状态变迁

| 操作               | 触发事件                           | 方法                                                                                                    | 状态变迁                                                                                                                                                             | 跨部分联动                                       |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 打开会话           | 会话管理页点击行                   | `openSession(path)`                                                                                     | `openPaths += path`（若未在）；`activePath ← path`；懒加载该会话消息                                                                                                 | 打开标签（助手 tabs +1），会话管理页当前标记切换 |
| 新建任务（新会话） | 助手面板 tabs 栏右端「新会话」按钮 | `conversationStore.createNew()`                                                                         | `activePath ← null`（新任务态，不发消息不建会话）                                                                                                                    | 侧边栏「当前」消失                               |
| 发送消息           | 输入框回车/发送键                  | `inputStore.submit()` → `conversationStore.send(text, skills)`                                          | 本地乐观 append 用户消息；`streamingSessions += key`；新任务态首条消息 → 后端建会话返回真实 path（见 6.4）；执行中 Enter 走 `queueSend`（steer；⇧⌘Enter = followUp） | 会话名/preview 更新                              |
| Slash 命令         | `/` 唤起补全 → 回车执行            | `inputStore.submit()` → `commandStore.intercept()` / 透传 `conversationStore.send(..., isCommand=true)` | builtin（new/compact/model/thinking/name/session/copy）即地执行，不进 prompt；未识别透传 pi prompt 通道（扩展命令 / prompt template）                                | /model 开选择器、/session 开面板、/new 换会话    |
| 切换会话           | 点击 tab / 展开项                  | `openSession(path)`（同一命令）                                                                         | `activePath ← path`                                                                                                                                                  | 侧边栏当前标记切换                               |
| **关闭标签**       | tab × / 助手面板 tabs ×            | `closeSessionTab(path)`                                                                                 | `openPaths -= path`；若关闭的是活跃 → 激活相邻打开项，无剩余 → `activePath ← null`（新任务态）。**消息缓存保留，数据不删**                                           | 会话管理页当前标记消失（数据仍在全部列表）       |
| **删除会话**       | 会话管理页行内删除按钮             | `deleteSession(path)`                                                                                   | 后端删 JSONL；`sessions -= path`；`openPaths -= path`；若是活跃 → 激活列表首个或 null                                                                                | 会话管理页列表 −1（真删除）                      |
| 停止执行           | 侧边栏/输入区停止                  | `abortSession(path)`                                                                                    | 后端中止；`streamingSessions -= path`                                                                                                                                | 停止按钮消失                                     |
| 重命名会话         | —（暂无 UI 入口）                  | `renameSession(path, name)`                                                                             | `sessions[i].name` 更新                                                                                                                                              | tabs/侧边栏同步                                  |

### 6.4 系统事件驱动的变迁（AgentEvent 上行流）

| 事件                            | 状态变迁                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `session_created`               | 新任务态迁移：`__new__` → 真实 `path`；`sessions += 新会话`；`openPaths += path` 并激活（**首个消息自动开标签**） |
| `text_delta` / `thinking_delta` | `messagesBySession[activeKey]` 追加增量                                                                           |
| `tool_start` / `tool_end`       | 消息流追加工具块（含结果/错误）                                                                                   |
| `done`                          | `streamingSessions -= path`；tokens 累计；`sessions[i].preview` 更新                                              |
| `error`                         | 消息流追加错误；`streamingSessions -= path`                                                                       |

### 6.5 本部分规则

- **关闭 ≠ 删除（按钮语义分层）**：助手面板 tabs 的 × = 关闭标签（只动 `openPaths`）；
  **删除按钮只在二级列表**（才动 `sessions` + 后端数据）；streaming 中行内显示停止按钮（替代删除）。
- 当前会话必在 `openPaths` 内（不变量，见 §九）。
- streaming 会话：tab 内脉冲点 + 侧边栏「执行中」+ 停止按钮。
- 模型未配置：输入区禁用 + 「⚠ 未配置模型」提示 + 跳配置入口（打开模型设置插件页）。
- 输入区模型/思考档位切换器与模型设置页默认模型条**同源**：均调 `configure`（全局默认
  即时生效，非会话级覆盖），两处 UI 是同一 config 的两个投影。
- 消息气泡：用户消息右对齐靛蓝气泡；助手消息左对齐竖线引导；内容块三分——
  thinking（可折叠）/ tool（ToolCallChip）/ text（纯文本）。
- **会话按域归档**：二级列表按「会话 × 域」分组（组头 = favicon + 站点标题 + 计数，可折叠）；
  未关联域的会话归入「其他会话」。关联来自浏览器捕获（turn 边界落定），非人工标签。
- 自动滚动：距底 <80px 才跟随（用户上翻阅读时不强拉）。

---

## 七、配置面板（配置即插件：config 页体系）

**形态**：各系统功能的配置 = 各自插件的 config 页
（manifest `config` 贡献点，`<pluginId>-config` 扩展实例，统一中栏 tab）。
入口：S2 插件列表行点击（见 §4.4）。

- `model-config` 模型设置：默认模型条（模型 + 思考档位 + 应用）+ 供应商/模型目录 CRUD。
- `session-manager` 会话管理：全部会话列表（按访问域归档、搜索过滤、切换当前、删除/停止执行）。
- 文件型插件自身设置：html-editor / milkdown-editor / text-editor 的 config 页（介绍 + 自身偏好）。
- `browser` 网站资料管理面（`browser-home`）：**域列表与 L2 站点导览（`RESOURCES/<域>.md`）
  的唯一展示地**。**单列上下布局**：①顶部能力介绍（一句分层说明 + 可折叠的 Agent 工具清单）
  ②操作条（打开网址 / 搜索域名）③**归档白名单**（**手动收录**；名单内域（含子域）
  建域目录写快照，名单外域**不落盘**——只在侧边栏「临时网页」分组里跟打开的标签页
  对应，关标签即消失；名单外站点进「最近访问」反馈环可一键收录）④域名列表（全宽行：勾选框 + favicon + 站点标题
  - 域名·页数·最近捕获；行内动作常显：重抓图标 / 删除，孤儿目录带「仅目录文件」徽标）
    ⑤选中域的 L2 导览（TOC：区块头显示站点/域名/页数 +「在浏览器打开 / 重抓图标 / 删除该域」，
    正文为渲染后的 markdown，元信息呈胶囊条）。
    **删除交互**：行内删除（或详情按钮）→ **行内确认面板**（点名对象 + 删除范围与数量 +
    可选「同时从归档白名单移除」+ 取消/删除），Esc 取消；
    列表工具条提供**全选 / 删除所选**（批量）与**清理孤儿目录（N）**（磁盘上只剩导览文件的域）。
    默认只列域名，选中才渲染导览；资源面板不承载域列表（单页看资源面板，整域看插件页）。

### 7.1 数据模型

- `AgentStatus`：`configured / provider / modelId / thinkingLevel / workspacePath`（后端持有）。
- **零默认值铁律**：渲染层不写死 provider/model（初始 = 「未配置」），真值来自主进程
  （pi settings.json 的 defaultProvider/defaultModel → runtime 模型解析）；变更经
  `agent_status_changed` 事件收敛（setModel / 工作区切换 / 目录重建），不靠焦点轮询。
- `ModelsConfigView`：models.json 全量（providers + models[]，**pi ProviderConfigSchema 同构**；apiKey 永不回传渲染层）。
- **供应商级字段**：id（小写连字符）/ name / baseUrl / api（openai-completions · openai-responses · anthropic-messages）/ apiKey（存 auth.json）。
- **模型级字段**（pi ModelDefinitionSchema / models.dev 同构）：id / name / reasoning / input（text·image）/ cost（input·output·cacheRead·cacheWrite，$/百万）/ contextWindow / maxTokens / thinkingLevelMap（档位映射）/ compat 常用项。

### 7.2 config 页数据面（app:\* 白名单 RPC）

插件页面（WebContentsView）无 node 能力，经 `window.extension.invoke(cmd, payload)`
**直连主进程**（渲染层不中转数据；白名单域：配置/资源/插件清单）：

| 命令                                                                        | 域                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `app:agent:status` / `app:agent:configure` / `app:agent:models`             | 运行配置快照 / 增量配置 / 模型目录拍平                                                |
| `app:models:read / saveProvider / deleteProvider / saveModel / deleteModel` | models.json 目录 CRUD                                                                 |
| `app:plugins:list`                                                          | 插件清单                                                                              |
| `app:browser:domains` / `app:browser:guide`                                 | 网站资料域列表（含 favicon）/ 选定域 L2 导览                                          |
| `app:browser:open` / `app:browser:refreshIcon` / `app:browser:deleteDomain` | 打开网页 / 重抓域图标 / 删除域名下全部资料（含孤儿目录）                              |
| `app:browser:policy` / `app:browser:setPolicy` / `app:browser:clearBlocked` | 归档白名单（手动收录；名单外不落盘、只作「临时网页」标签页）/ 保存名单 / 清空被挡记录 |

（总线通道另有 `post` / `on` / `loaded`，见 §五 视图总线与 InstanceFSM。）

### 7.3 操作与状态变迁

| 操作                  | 触发事件                                | 方法                                               | 状态变迁                                                                                          | 跨部分联动                                                 |
| --------------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 切换默认模型/思考档位 | model-config 页默认模型条「应用」       | `configure({ provider, modelId, thinkingLevel })`  | 后端写 config.json + 状态快照                                                                     | S4 模型/思考切换器标签同步；未配置时输入区解锁（警示消失） |
| 增/改/删供应商        | 供应商表单保存/删除                     | `saveProvider / deleteProvider`                    | models.json 写盘 → **ModelRuntime 整体重建**（无热重载）+ auth.json key 重新注入 + 会话上下文换代 | 供应商树刷新；模型目录实时更新                             |
| 增/改/删模型          | 模型表单保存 / 行删除                   | `saveModel / deleteModel`                          | 同上                                                                                              | 模型行徽章（推理/图像/费用）刷新                           |
| 配置供应商 Key        | 供应商表单 API Key（留空不改）          | `configure({ apiKey })`                            | **apiKey 持久化 auth.json** + 内存 overlay                                                        | key 重启恢复                                               |
| 切换工作区            | TitleBar 左段工作区下拉（非 config 页） | `pickWorkspace()` → `configure({ workspacePath })` | `workspacePath` 更新                                                                              | 文档全量重扫（S2 列表刷新）；会话目录切换；技能刷新        |

### 7.4 本部分规则

- 表单草稿为**未提交编辑态**，保存前不落盘；保存失败显示行内错误；同一时刻至多一张表单展开（供应商/模型编辑互斥）。
- **存储三文件分权**：
  - `models.json`（pi ProviderConfigSchema / ModelDefinitionSchema 同构）——供应商/模型目录，任何写盘触发 **ModelRuntime 整体重建**（无热重载：重建 runtime + registry，从 auth.json 重注入已有 key，全部会话上下文换代 rebuildContext）；
  - `config.json`——默认模型/思考档位/工作目录（configure 即时生效）；
  - `auth.json`（pi AuthStorage 格式）——供应商 key。
- **API Key 持久化到 auth.json**：内存 overlay 重启即丢（key 失效会 401 卡「执行中」），因此 configure 时双写盘 + 内存，ModelRuntime 启动时自动恢复；**saveProvider 不带 key 时保留旧值**（key 管理独立走 configure）。
- **pi 校验守卫**：写盘 → `ModelRuntime.create`（即 pi 的 `ModelConfig.load`）→ 期望 provider/model 未被收录则**回滚文件并报错**（pi 对 schema 不符的 models.json 会丢弃全部 provider，拦截必须走真实加载链路）；baseUrl 必填前置校验（pi 组装供应商的硬要求）。
- **供应商 id 规则**：小写字母/数字/连字符（后端正则校验）；模型 id 必填。模型行徽章：推理（violet）/ 图像（teal）/ 默认（当前 provider/modelId 匹配时）+ 上下文规模与费用 meta；当前供应商头带「当前」标。
- **默认模型条与 S4 模型切换器同源**：均调 `configure`（全局默认即时生效，非会话级覆盖）；思考档位为草稿制（「应用」才提交）。
- 密钥值**永不明文回显**（列表只展示 label/key 名）；加密不可用时给出警示。

---

## 七·二、插件列表与插件页体系

**插件列表 = S2 Sidebar 的 plugins 形态**（TitleBar 📦 图标切入/退出，见 §三）。

### 状态

| 状态      | 类型           | 初始值       | 持久化   | 说明                                               |
| --------- | -------------- | ------------ | -------- | -------------------------------------------------- |
| `plugins` | `PluginInfo[]` | onMount 加载 | 后端清单 | 插件运行时信息（含贡献点计数 + hasConfig/hasHome） |

### 规则

- 插件行：Package 图标（青色系）+ 名称 + v 版本 + 贡献点计数 meta
  （N 视图 · N Skill · N 工具；无贡献点时显示插件 id）。
- **行点击 = 打开该插件自己的 config 页**（§5.3 `openPluginConfig`——每个插件必有；
  config 页 = 插件自己的页面：介绍 + 设置一体，无「设置」后缀）。
- **首页机制**：manifest 声明首页（`hasHome`）的插件经 `openPluginHome(plugin)` 打开 `<pluginId>-home` 约定扩展实例。
- 左栏收起态/AI 右栏与其他形态共享同一套状态（`sidebarCollapsed` / `aiOpen` / `aiFloating`）。

---

## 八、跨部分状态联动总表

一个动作触发的多域连锁：

| 动作                             | Sidebar                                                                                       | 资源面板                                              | 会话面板                                                                                      | TitleBar/其他                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 打开文档                         | 分组卡片 + 展开项 +1                                                                          | 新 tab + TitleBar 地址栏 + 内容加载                   | —                                                                                             | —                                                                                     |
| 关闭最后一个文档 tab             | 分组卡片消失                                                                                  | 空态引导                                              | —                                                                                             | 地址栏隐藏                                                                            |
| 打开会话                         | —（会话导航不在 Sidebar）                                                                     | —                                                     | 新 tab + 消息加载                                                                             | —                                                                                     |
| 关闭会话标签                     | —（会话导航不在 Sidebar）                                                                     | —                                                     | tabs −1；活跃切换                                                                             | 数据保留                                                                              |
| 删除会话（会话管理页）           | —（会话导航不在 Sidebar）                                                                     | —                                                     | tabs −1；活跃重选                                                                             | 后端数据删除                                                                          |
| 关闭标签（助手 tabs ×）          | —（会话导航不在 Sidebar）                                                                     | —                                                     | tabs −1；活跃切换                                                                             | 数据保留                                                                              |
| 新会话首条消息                   | —（会话导航不在 Sidebar）                                                                     | —                                                     | `__new__`→真实 path；自动开标签                                                               | —                                                                                     |
| 打开插件 config 页（插件行）     | —                                                                                             | tabs +1 + 地址栏（`app://plugin/<id>`）+ 面板自动展开 | —                                                                                             | —                                                                                     |
| 编辑器脏态变化                   | —                                                                                             | tab 脏点出现/消失                                     | —                                                                                             | —                                                                                     |
| streaming 开始/结束              | 「执行中」/停止按钮                                                                           | —                                                     | tab 脉冲点                                                                                    | —                                                                                     |
| 主题切换                         | 全局变量                                                                                      | webview 广播 `event:theme`                            | —                                                                                             | 图标高亮态切换                                                                        |
| aiOpen 关闭                      | —                                                                                             | —                                                     | 整栏收起                                                                                      | 图标去高亮                                                                            |
| 模型目录 CRUD（model-config 页） | —                                                                                             | —                                                     | S4 模型选择器目录刷新（删当前默认模型时回退 settings 默认链，经 `agent_status_changed` 收敛） | models.json 写盘 + ModelRuntime 重建（会话上下文换代）                                |
| 切换默认模型/思考档位（§7.3/S4） | —                                                                                             | —                                                     | 模型切换器标签同步；思考档位刷新                                                              | `settings.json` 默认（defaultProvider/defaultModel）+ `agent_status_changed` 事件收敛 |
| 切换工作区（TitleBar）           | 全部分组列表重扫（含每域「网站资料」组）                                                      | 打开的实例失效清理                                    | 会话目录切换（列表重载）；会话×域索引切区                                                     | TitleBar 地址栏 url 前缀全变；技能刷新                                                |
| 刷新应用（重启）                 | 持久字段全恢复（theme/布局/activePath/**openPaths**/skills/aiOpen/sidebarView/sidebarDomain） | 实例态清空（主进程实例表随进程销毁）                  | openPaths **现场恢复**（无效项过滤，空则选首个会话）                                          | 配置快照由 `agent_status` 首拉（渲染层无写死默认值）                                  |

---

## 九、状态不变量

任何状态管理实现（Context / Store / Reducer）都必须满足：

1. **打开 ⊆ 全部**：`openPaths ⊆ sessions 的 path 集合`；`openDocs 的文档 ⊆ documents`。
2. **当前 ∈ 打开**：`activePath ≠ null ⇒ activePath ∈ openPaths`；`activeInstanceId ≠ null ⇒ 在 instances 中`。
3. **当前唯一**：每个面板同时至多一个「当前」（activePath / activeInstanceId）。
4. **打开多值，当前唯一**：展开项渲染全部打开项，当前标记恰好零或一个。
5. **关闭标签不触后端删除**；删除会话必须同时清理 openPaths 与活跃重选。
6. **tabs 与展开项同源**：会话 tabs ≡ openPaths，文档 tabs ≡ openDocs 的实例集——两处 UI 是同一状态的两个投影，禁止各自维护副本。
7. **持久化分界**：用户偏好与现场（主题/布局/选中态/技能/openPaths/sidebarView）持久化到主进程 `ui-state.json`（按工作区隔离）；领域数据（消息/文档）只存后端经 URA 网关；瞬时态（instances/streaming）不落盘。存储层架构详见 `docs/state-architecture.md`。

---

## 十、导航规则（sidebarView 形态机）

```
sidebarView → 左栏内容推导：
  main      → 主列表（分组 + 打开项聚拢；资源分组行 → 二级形态）
              本地文档 / 每个域一个「网站资料」组（favicon + 站点标题 + 页数）
              / 存在临时标签页时一个「临时网页」组
  docs      → 文档二级列表（本地文档）；业务数据不在 Sidebar 承载（data 轨经工具查询）
  web       → 选中域（sidebarDomain）的 L3 页面快照；`__temporary__` = 打开的名单外
              标签页列表（域列表与 L2 导览归插件设置页）
  plugins   → 插件列表（TitleBar 📦 toggle；插件行 → 打开 config 页）
  settings  → 设置域列表（TitleBar ⚙️ toggle）
```

- **入口矩阵**：资源/域分组行 → 对应二级形态；TitleBar 📦 → `plugins ⇄ main` toggle；
  二级列表返回键 → `main`；会话列表经 TitleBar ⚙️ → 设置列表 →「会话管理」进入。
- `sidebarView` 持久化，重启恢复上次左栏形态。

---

## 十一、附录：视觉规范速查

| 元素            | 规格                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高亮色          | 靛蓝 `#4F6BED`（暗色文字 `#6c86f0`）、hover `#3D56E0`                                                                                                                                                                                                                                                                                                               |
| 文字体系        | titlebar/侧边栏主文字 12px；标题 12px semibold；行标题 13px；副文字 12px；时间 11px                                                                                                                                                                                                                                                                                 |
| 图标体系        | 分组图标容器 w-8；行图标 w-7；行内图标 w-4；按钮图标 w-3~3.5                                                                                                                                                                                                                                                                                                        |
| 行内边距        | 侧边栏行 `px-2 py-1.5`；标题↔副标题 `mt-[5px]`；列表容器 `px-1 py-1 space-y-1`                                                                                                                                                                                                                                                                                      |
| Tabs            | 高 h-9；`px-5`；标题居中（图标/关闭钮绝对定位补偿）；关闭钮 `right-0.5` hover 显；溢出时左右箭头滚动（180px/次，激活 tab 自动 scrollIntoView）；会话 tab `max-w-52` 截断                                                                                                                                                                                            |
| TitleBar 地址栏 | 居中胶囊 h-8（max-w 680px）；等宽字体 12px truncate；spinner + 动作按钮右置（通用「刷新」+ 声明式贡献 titlebarActions，如 html-editor layout-switch）；有激活资源强制显示、无则隐藏；本地文档 = 相对路径，应用内资源 = `app://` scheme                                                                                                                              |
| TitleBar 左段   | Sidebar 收起/展开 toggle（PanelLeft 图标，收起=Open/展开=Close）+ 工作区下拉；下拉项：当前目录 / 选择目录… / 系统文件管理器打开                                                                                                                                                                                                                                     |
| TitleBar 右侧   | AI（💬）/ 主题（☀🌙）/ 插件（📦）图标按钮 h-8 w-8 + W 徽标（h-7 w-7 圆形靛蓝）；打开态 = 图标本体靛蓝高亮                                                                                                                                                                                                                                                           |
| 圆角            | hover/卡片 rounded-lg；按钮 rounded-md                                                                                                                                                                                                                                                                                                                              |
| 边界拖拽        | 1px 细线，hover 变靛蓝；命中区 11px（视觉 1px + 10px 外扩）；**左栏拖到 <140px 松手自动收起为 56px 图标列**（收起态左边界可向外拖拽展开；拖宽则夹回 15%~30% 保持展开）                                                                                                                                                                                              |
| 滚动条          | 全域统一（主窗口 + webview）：**标准属性**（`scrollbar-width:thin` + `scrollbar-color:<thumb> transparent`）→ 原生 overlay 条（不占布局 / 滚动浮现 / 停手隐去），thumb 半透明（亮 `rgb(24 24 27/.35)` / 暗 `rgb(255 255 255/.4)`）；单一事实源 `shared/styles/scrollbar.css`（主窗口构建期 @import / 插件页由 extension-preload 注入）；tabs 滚动条隐藏（箭头驱动） |
| 状态指示        | 图标本色高亮（靛蓝）= 开启；脉冲点 = streaming；琥珀圆点 = tab 未保存（脏）；左缘竖条 = 当前项；玫红文字 = 待审数                                                                                                                                                                                                                                                   |
| 分组色系        | 本地文档 amber / 业务数据 teal / 网站资料 sky / 临时网页 zinc / 会话靛蓝 / 插件 cyan                                                                                                                                                                                                                                                                                |
