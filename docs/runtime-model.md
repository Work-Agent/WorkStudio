# Electron 运行时对象模型

本文件固定本应用所依赖的 Electron 运行时契约：对象层级、归属关系、查询方式与硬约束。
视图生命周期（`view-lifecycle.md`）与状态归属（`state-architecture.md`）的设计以本文件为前提。

## 一、层级

创建方向自上而下，通知方向自下而上：

```
进程（browser process：Node.js 运行时 + 原生 UI 层）
└─ app                              进程级单例：应用生命周期
    └─ BaseWindow / BrowserWindow    窗口（BaseWindow 无内容，BrowserWindow 含 webContents）
        └─ contentView（View 树）     视图层：addChildView 顺序 = z-order
            └─ WebContentsView       视图实例（可创建或收养一个 WebContents）
                └─ WebContents       「一份网页内容」= 一个 renderer 进程
                    └─ WebFrameMain   帧（主帧 + 子帧）

进程级侧挂（不挂在窗口上）：
ipcMain（消息总线）· session（会话/分区）· protocol · nativeTheme · shell / dialog / Menu / screen
```

## 二、对象职责

### 2.1 app —— 进程级单例

应用的唯一代表，负责生命周期与进程级能力。

| 面       | 关键 API                                                                        |
| -------- | ------------------------------------------------------------------------------- |
| 启动     | `whenReady()`、`on('will-finish-launching')`                                    |
| 退出     | `quit()`、`exit()`、`on('before-quit')`、`on('will-quit')`                      |
| 窗口聚合 | `on('window-all-closed')`、`on('browser-window-created')`                       |
| 单实例   | `requestSingleInstanceLock()`、`on('second-instance')`                          |
| 路径     | `getAppPath()`（= asar 路径）、`getPath('userData' \| 'temp' \| 'logs' \| ...)` |
| 信息     | `getName()`、`getVersion()`、`getLocale()`、`commandLine.appendSwitch()`        |
| 平台     | `dock`（macOS）、`setAppUserModelId()`（Windows）、`setAboutPanelOptions()`     |

规则：`commandLine.appendSwitch()` 必须在 `whenReady` 之前调用，否则不生效。

### 2.2 BaseWindow / BrowserWindow —— 窗口

| 面       | 关键 API                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| 标识     | `id`（进程内唯一）、`isDestroyed()`                                                                                   |
| 内容     | `webContents`（1:1）、`contentView`（View 树根）                                                                      |
| 加载     | `loadURL(url)`、`loadFile(path)`                                                                                      |
| 显隐     | `show()`、`hide()`、`isVisible()`、`focus()`、`on('ready-to-show')`                                                   |
| 关闭     | `close()`、`destroy()`、`on('closed')`                                                                                |
| 外观     | `setTitleBarOverlay()`（Win/Linux 三键覆盖层）、`setWindowButtonVisibility()`（macOS 红绿灯）、`setBackgroundColor()` |
| 静态查询 | `getAllWindows()`、`getFocusedWindow()`、`fromId(id)`、`fromWebContents(wc)`                                          |

规则：窗口对象是句柄，`closed` 之后调用任何方法抛错，必须先判 `isDestroyed()`。
窗口保活由原生侧负责，JS 变量丢失不影响窗口存活；需要时经 `getAllWindows()` 反查。

### 2.3 View / WebContentsView —— 视图层

窗口内的原生视图树。所有子视图都绘制在窗口自身 DOM 内容之上，`z-index` 无法跨越这一层。

| 面   | 关键 API                                                                               |
| ---- | -------------------------------------------------------------------------------------- |
| 层级 | `addChildView(view, index?)`、`removeChildView(view)`、`children`                      |
| 几何 | `setBounds(rect)`、`getBounds()`、`on('bounds-changed')`                               |
| 显隐 | `setVisible(boolean)`、`getVisible()`                                                  |
| 外观 | `setBackgroundColor(color)`（支持 ARGB）、`setBorderRadius(r)`、`setBackgroundBlur(r)` |
| 内容 | `WebContentsView` 的 `webContents`；构造时可传入已有 `webContents` 收养                |

规则：

- z-order 唯一由 `addChildView` 顺序决定（不带 `index` = 置顶；重复添加同一视图 = 提升到顶层）。层级是隐式状态，必须有单一入口的层级管理器。
- 任何新加入的视图都会盖住已有视图，置顶需重新提升。
- 无逐像素鼠标穿透：`setIgnoreMouseEvents` 仅存在于窗口级（`BaseWindow`），视图矩形整体捕获鼠标；`setBorderRadius` 的圆角外沿同样捕获点击。
- 一个 `WebContents` 同时只能出现在一个视图里（收养语义的硬约束）。

### 2.4 WebContents / WebFrameMain —— 内容与帧

| 面            | 关键 API                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| 标识          | `id`、`processId`、`isDestroyed()`、静态 `getAllWebContents()` / `fromId()` / `fromFrame()` |
| 会话          | `session`                                                                                   |
| 帧            | `mainFrame`、`WebFrameMain.fromId(processId, routingId)`                                    |
| 主进程 → 渲染 | `send(channel, ...args)`、`postMessage(channel, msg, transfer?)`                            |
| 注入          | `executeJavaScript(code)`、`executeJavaScriptInIsolatedWorld(id, scripts)`                  |
| 导航          | `loadURL()`、`getURL()`、`on('did-navigate')`、`on('did-finish-load')`、`on('dom-ready')`   |
| 弹窗收编      | `setWindowOpenHandler(handler)`（`target="_blank"` / `window.open` 的接管点）               |
| 生命周期      | `on('render-process-gone')`、`on('page-title-updated')`、`close()`、`focus()`               |
| 调试          | `openDevTools()`、`setZoomFactor()`                                                         |

### 2.5 ipcMain / ipcRenderer / contextBridge —— 消息

| 对象            | 位置    | 能力                                                                                 |
| --------------- | ------- | ------------------------------------------------------------------------------------ |
| `ipcMain`       | 主进程  | `handle` / `handleOnce` / `removeHandler`（双向）、`on` / `once` / `off`（单向接收） |
| `ipcRenderer`   | preload | `invoke`（双向）、`send`（单向）、`on`（接收主进程推送）                             |
| `contextBridge` | preload | `exposeInMainWorld(key, api)`、`exposeInIsolatedWorld()`                             |

规则：

- `ipcMain` 是进程级 channel → handler 映射表，不持有任何窗口。来源窗口只能由回调参数 `event.sender`（WebContents）判定，再经 `BrowserWindow.fromWebContents()` 定位。
- 同一 channel 重复 `handle` 会抛错：注册点必须集中在模块初始化阶段，不可放在窗口创建流程里。
- 消息跨进程使用结构化克隆：函数、类实例、Symbol、原型链都不传递；返回的错误在渲染端只剩字符串化信息。
- channel 名是裸字符串，编译期无任何关联校验。本应用统一由通道表收敛（见 `state-architecture.md`）。

### 2.6 进程级工具与服务

| 对象                | 职责                                                                         | 本项目用途                                                                 |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `session`           | 会话/存储分区（cookie、缓存、权限、UA、代理）                                | 默认会话承载主窗口与扩展视图；`setPermissionRequestHandler` 是权限门控落点 |
| `protocol`          | 自定义协议注册                                                               | 扩展页面以自定义协议装载（隔离于 `file://`）                               |
| `shell`             | OS 集成：`openPath`、`openExternal`、`showItemInFolder`、`trashItem`、`beep` | 单一 IPC 通道暴露给渲染层                                                  |
| `dialog`            | 原生对话框（`showOpenDialog` / `showSaveDialog` / `showMessageBox`）         | 目录选择与另存为，传窗口参数以获得模态行为                                 |
| `Menu` / `MenuItem` | 原生菜单（含 `popup()` 上下文菜单）                                          | 原生右键菜单：可覆盖原生视图，且代价是不受样式控制                         |
| `nativeTheme`       | 主题（`themeSource` / `shouldUseDarkColors`）                                | 主题变更时同步到原生窗口底色与三键覆盖层                                   |
| `screen`            | 显示器信息与光标位置                                                         | 多显示器下的窗口定位                                                       |

## 三、关联与查询

| 关系            | 方向     | 查询方式                                                           | 真相位置     |
| --------------- | -------- | ------------------------------------------------------------------ | ------------ |
| 进程 ↔ 全部窗口 | 1:N      | `BrowserWindow.getAllWindows()`                                    | 原生窗口表   |
| 窗口 ↔ 内容     | 1:1      | `win.webContents` ⇄ `BrowserWindow.fromWebContents()` / `fromId()` | 原生绑定     |
| 窗口 ↔ 视图树   | 1:N      | `win.contentView.children`                                         | 原生 View 树 |
| 视图 ↔ 内容     | 1:1      | `WebContentsView` 构造参数 / `.webContents`                        | 原生绑定     |
| 内容 ↔ 帧       | 1:N      | `wc.mainFrame` ⇄ `WebFrameMain.fromId(pid, routingId)`             | 原生         |
| 内容 ↔ 会话     | N:1      | `wc.session` ⇄ `session.fromPartition()`                           | 原生         |
| 消息 ↔ 来源窗口 | 派发瞬间 | `event.sender` → `BrowserWindow.fromWebContents()`                 | 路由时查表   |

## 四、不变量

1. **真相在原生层，JS 对象是句柄。** 窗口表、内容注册表、View 树都由 C++ 维护；JS 侧不持有副本，只做查询。对象存活与句柄存在是两件事。
2. **`ipcMain` 不持有窗口。** 它是纯消息总线；按窗口过滤只能在 handler 内读 `event.sender`。
3. **一个 `WebContents` 同时只能出现在一个视图内。** 同一页面无法在两个视图同时呈现：要么共享实例，要么分别加载。
4. **三套标识各管一段**：`win.id`（窗口）、`wc.id`（内容）、`(processId, routingId)`（帧）。跨进程匹配使用第三套。
5. **DOM 的 `z-index` 作用域止于窗口自身的 web 内容。** 窗口内所有原生视图恒在其上层；视图之间只有 `addChildView` 顺序一种层级手段。
6. **`app` 的窗口相关事件是聚合状态**（全关、新建），不表示与具体窗口的绑定关系。
7. **安全默认值**：`nodeIntegration` 默认 `false`、`contextIsolation` 默认 `true`、`sandbox` 默认 `true`（Electron 20 起）。preload 是渲染层与 Electron API 的唯一桥。
8. **打包期 fuses 改变运行时能力**：`RunAsNode` 关闭后 `ELECTRON_RUN_AS_NODE` 不可用（独立 Node 进程改用 `utilityProcess`）；`OnlyLoadAppFromAsar` 关闭了 asar 之外的加载路径；`EnableEmbeddedAsarIntegrityValidation` 要求应用已签名。

## 五、生命周期时序

启动：

```
二进制定位 app.asar → 读取 package.json 的 main → 执行主进程入口
  → app.commandLine 相关设置（须早于 whenReady）
  → app.whenReady()
      → new BrowserWindow({ webPreferences: { preload } })
      → 注入 preload（先于页面脚本）
      → loadURL(dev server) 或 loadFile(renderer/index.html)
      → 'ready-to-show' → show()
```

运行：

```
渲染层调用 preload 暴露的方法
  → ipcRenderer.invoke(channel, arg)
      → 主进程 ipcMain.handle 的回调（携带 event.sender）
          → 执行主进程能力（fs / dialog / shell / session / 视图管理）
      → 返回值结构化克隆回渲染层
```

关闭：

```
win.close() → 'close' → 'closed'
  → 窗口表移除 → 计数归零 → app 'window-all-closed'
      → 非 macOS：app.quit() → 'before-quit' → 'will-quit' → 退出
```

## 六、IPC 全链路

| 方向                   | 链路                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| 渲染 → 主（请求/响应） | 页面 → `contextBridge` 暴露的方法 → `ipcRenderer.invoke` → `ipcMain.handle` → 主进程执行 → 序列化返回 |
| 主 → 渲染（推送）      | 主进程 `webContents.send(channel, payload)` → preload `ipcRenderer.on` 包装的订阅 → 页面回调          |
| 渲染 → 主（单向）      | `ipcRenderer.send` → `ipcMain.on`                                                                     |

约束：

- 载荷必须可结构化克隆；大对象按值传递，不共享引用。
- 错误在渲染端退化为字符串，需要保留错误语义时使用结构化信封（`{ ok: true, data } | { ok: false, error }`）。
- channel 名无类型约束，跨进程两侧的一致性靠本应用的通道表保证。

## 七、本应用约定

| 能力                         | 归属                        | 落点                                              |
| ---------------------------- | --------------------------- | ------------------------------------------------- |
| 应用生命周期、窗口创建       | 主进程                      | `src/main.ts`                                     |
| 渲染层可达能力（按域拆分）   | 主进程                      | 主进程 IPC 域模块，经通道表注册                   |
| 页面桥接与能力白名单         | preload                     | `src/preload.ts`（`contextBridge` 暴露）          |
| 窗口/视图层级管理            | 主进程                      | 单一入口的视图宿主模块（z-order、bounds、可见性） |
| 打开的视图实例（tabs）       | 渲染层集合语义 + 主进程承载 | `state/tabs.ts`（集合）、视图宿主（实例）         |
| 用户操作状态（UiState）      | 渲染层决策、主进程持久化    | `state/uiState.ts` + 主进程 ui-state 存储         |
| 领域状态（会话、文档、模型） | 主进程真值、渲染层投影      | 领域 store + 事件订阅                             |

## 八、常见陷阱

| 陷阱                  | 表现                                           | 规避                                                                                      |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 销毁后调用            | `Object has been destroyed`                    | 操作前判 `isDestroyed()`；用 `closed` 事件清理登记                                        |
| 重复注册 handler      | `Attempted to register a second handler`       | 注册集中在初始化阶段，不放窗口创建流程                                                    |
| 生命周期竞态          | 渲染层 invoke 早于 handler 注册 / 早于窗口就绪 | 主进程初始化先于建窗；渲染层以显式就绪握手为闸门                                          |
| 跨进程错误丢失        | 只有字符串，没有堆栈/错误类型                  | 结构化信封承载错误码与消息                                                                |
| 句柄与存活混淆        | 用变量存在判断窗口存活                         | 以 `getAllWindows()` / `isDestroyed()` 为准                                               |
| 原生视图遮挡 DOM 浮层 | 浮层被页面内容盖住                             | 层级策略显式化（见 `view-lifecycle.md`）                                                  |
| asar 内路径           | 打包后资源找不到                               | 应用内路径用 `app.getAppPath()` / `__dirname` 推算；asar 外资源用 `process.resourcesPath` |
