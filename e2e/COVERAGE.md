# E2E 覆盖矩阵

> 结论先行：核心壳层、路由、资源页、设置页加载已有覆盖；
> 助手真实对话、模型配置、设置页写操作、插件页面交互仍是缺口。
> 命令层通过 ≠ 用户路径通过；主路径必须走真实点击。

## 运行模式

| 模式       | 命令                            | 说明                                                         |
| ---------- | ------------------------------- | ------------------------------------------------------------ |
| 隔离       | `pnpm test:e2e [spec]`          | 临时 data root + 构建产物，默认模式                          |
| dev        | `pnpm test:e2e:dev [spec]`      | renderer 走 Vite dev server，主进程/preload 构建产物         |
| dev attach | `pnpm test:e2e:attach`          | 连接 dev extension 维持的 CDP 9222 窗口，不重复启动 Electron |
| 单文件     | `pnpm test:e2e e2e/xxx.spec.ts` | 只跑目标 spec                                                |
| 单用例     | `pnpm test:e2e -g "关键字"`     | 只跑匹配用例                                                 |

## 已覆盖

| 领域       | 用户路径/行为                            | 测试                        | 类型        |
| ---------- | ---------------------------------------- | --------------------------- | ----------- |
| 启动       | 主窗口、壳层、三栏入口                   | `smoke.spec.ts`             | UI          |
| 生命周期   | 同 data root 重启                        | `restart.spec.ts`           | App         |
| 工作区     | 切换、重启恢复                           | `workspace.spec.ts`         | UI + App    |
| 工作区     | 切换后 Agent 进入新域                    | `regressions.spec.ts`       | 命令        |
| 导航       | 资源 / 插件 / 设置侧栏切换               | `navigation.spec.ts`        | UI          |
| 资源       | 真实点击分组 → 文件 → 打开 Markdown      | `resource.spec.ts`          | UI          |
| 资源       | 编辑后 Ctrl/Cmd+S 保存回磁盘             | `resource-save.spec.ts`     | UI + 文件   |
| 设置       | 全部内置设置页可加载、无脚本错误         | `settings-pages.spec.ts`    | UI          |
| 设置       | 设置页命令经 appBridge                   | `regressions.spec.ts`       | 命令        |
| 设置       | 侧栏设置列表点击打开页面                 | `settings.spec.ts`          | UI          |
| 设置       | 内置设置页 provider 解析                 | `settings-provider.spec.ts` | 单元        |
| 插件       | 本地插件安装 / 卸载                      | `plugin-install.spec.ts`    | UI + 文件   |
| 插件       | 插件页 / 插件设置页 provider             | `plugins-provider.spec.ts`  | 单元        |
| 视图       | 打开 / 关闭设置视图                      | `view-lifecycle.spec.ts`    | UI          |
| 视图       | 多标签、激活                             | `tabs.spec.ts`              | UI          |
| 视图       | 视图注册表 pin/move/系统视图             | `views-registry.spec.ts`    | 单元        |
| 视图       | Cmd/Ctrl+数字、Cmd/Ctrl+W                | `shortcuts.spec.ts`         | UI + 主进程 |
| 浏览器     | 打开临时浏览器视图                       | `browser.spec.ts`           | UI          |
| 主题       | 切换并重启保留                           | `theme.spec.ts`             | UI          |
| 助手       | 助手视图加载 / 未配置态                  | `assistant.spec.ts`         | UI          |
| 助手       | 会话标签跟随当前会话                     | `regressions.spec.ts`       | UI          |
| 对话框     | overlay 展示并应答                       | `regressions.spec.ts`       | UI          |
| 路径       | `app/`、`workspace/`、`settings://` 展示 | `path-display.spec.ts`      | UI          |
| dev attach | 连接 CDP 并点击侧栏导航                  | `dev-attach.spec.ts`        | UI          |
| 核心契约   | call / state / event / middleware        | `routing.spec.ts`           | 单元        |
| 会话流     | PiEventFrame 归约、增量校验              | `session-stream.spec.ts`    | 单元        |

## 部分覆盖

| 领域   | 现有测试               | 缺口                                               |
| ------ | ---------------------- | -------------------------------------------------- |
| 助手   | 加载未配置态、tab 投影 | 真实 prompt、stream、abort、消息历史、skills 激活  |
| 工作区 | 路径恢复、Agent 域切换 | 切换时关闭视图/页面会话、project settings 同步     |
| 设置页 | 全部可加载、命令可调用 | 实际填写/保存/切换后的 UI 结果                     |
| 浏览器 | 视图打开               | Agent 浏览器工具、白名单快照、地址栏动作           |
| 布局   | 主题、标签             | 侧栏拖拽、栏宽提交、浮动视图移动/缩放、tab reorder |

## 未覆盖

| 领域       | 建议测试                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型配置   | providers / catalog / api key login / OAuth dialog / save/delete 后 Agent 生效                                                                      |
| 设置写操作 | storage sessionDir、workspaces 切换、browser allowlist、resources 打开、sessions new/rename/delete、skills reload、preferences save、welcome create |
| 扩展管理   | packages catalog / install / remove、已加载资源刷新                                                                                                 |
| 插件页面   | 打开插件页、内容投递、编辑保存、插件设置持久化                                                                                                      |
| 插件侧栏   | 插件 / 会话列表项真实点击                                                                                                                           |
| 标题栏     | 工作区菜单、主题/助手开关、地址栏动作                                                                                                               |
| 对话框     | timeout / 取消 / 会话关闭结算                                                                                                                       |
| 通知       | notify → ToastHost                                                                                                                                  |
| 错误态     | 视图崩溃、页面加载失败、provider 失败                                                                                                               |
| dev attach | 真实资源打开（当前只验证导航点击）                                                                                                                  |

## 测试编写规则

1. **主路径必须点 UI**：打开资源、设置、插件、会话不能只用 `appBridge.call`。
2. **断言用户可见结果**：标题、页面、文件内容、路径文本，而不是内部 store。
3. **隔离写操作**：写文件、切工作区、安装插件必须使用临时 data root。
4. **attach 只读/轻交互**：dev attach 不切工作区、不写文件，避免污染正在开发的窗口。
5. **一个回归一个用例**：低级 UI 错误必须落成可复现 spec，而不是靠手测。
