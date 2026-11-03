# E2E 覆盖矩阵

> 结论先行：壳层、导航、设置页打开、标签、路径展示、资源页、插件安装已有覆盖；
> 助手真实对话、模型配置、设置页写操作、插件页面交互仍是缺口。
> 命令层通过 ≠ 用户路径通过；主路径必须走真实点击。

## 运行模式

| 模式                    | 命令                        | 说明                                        |
| ----------------------- | --------------------------- | ------------------------------------------- |
| dev extension           | `dev_test({ tag: "dev" })`  | 常驻 dev 窗口，CDP，不启动 Playwright       |
| CDP CLI                 | `pnpm test:e2e:cdp`         | 不经过 pi，排查扩展问题                     |
| Playwright 隔离         | `pnpm test:e2e`             | 临时 data root + 构建产物，提交前回归       |
| Playwright dev renderer | `pnpm test:e2e:dev`         | renderer 走 Vite，主进程/preload 用构建产物 |
| 单用例                  | `pnpm test:e2e -g "关键字"` | 只跑匹配 Playwright 用例                    |

## 共享 case（dev + Playwright）

| 领域   | 用户路径/行为                                | case                 |
| ------ | -------------------------------------------- | -------------------- |
| 导航   | 资源 / 插件 / 设置侧栏切换                   | `navigation.sidebar` |
| 设置   | `views.open` 打开内置插件设置页              | `settings.open`      |
| 设置   | 侧栏设置列表点击打开页面                     | `settings.sidebar`   |
| 视图   | 打开并关闭设置视图                           | `view.lifecycle`     |
| 浏览器 | 打开临时浏览器视图                           | `browser.open`       |
| 对话框 | overlay 展示并应答                           | `dialog.overlay`     |
| 标签   | 多标签、激活标签                             | `view.tabs`          |
| 路径   | `settings://`、`app/` 展示，不泄露完整工作区 | `path.display`       |

## Playwright-only / 隔离

| 领域     | 用户路径/行为                          | 测试                     |
| -------- | -------------------------------------- | ------------------------ |
| 启动     | 主窗口、壳层、三栏入口                 | `smoke.spec.ts`          |
| 生命周期 | 同 data root 重启                      | `restart.spec.ts`        |
| 工作区   | 切换、重启恢复                         | `workspace.spec.ts`      |
| 工作区   | 切换后 Agent 进入新域                  | `regressions.spec.ts`    |
| 主题     | 切换并重启保留                         | `theme.spec.ts`          |
| 快捷键   | Cmd/Ctrl+数字、Cmd/Ctrl+W              | `shortcuts.spec.ts`      |
| 资源     | 临时工作区创建 + 真实点击 Markdown     | `resource.spec.ts`       |
| 资源     | 编辑后保存回磁盘                       | `resource-save.spec.ts`  |
| 设置     | 全部内置设置页加载、无脚本错误         | `settings-pages.spec.ts` |
| 插件     | 本地插件安装 / 卸载                    | `plugin-install.spec.ts` |
| 助手     | 助手视图加载 / 未配置态                | `assistant.spec.ts`      |
| 助手     | 会话标签跟随当前会话                   | `regressions.spec.ts`    |
| 单元     | provider / registry / routing / stream | 多个 spec                |

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

## 测试编写规则

1. **主路径必须点 UI**：打开资源、设置、插件、会话不能只用 `appBridge.call`。
2. **断言用户可见结果**：标题、页面、文件内容、路径文本，而不是内部 store。
3. **隔离写操作**：写文件、切工作区、安装插件必须使用临时 data root；dev case 标记 `mutating`。
4. **共享 case 不 import Playwright**：只依赖 `e2e/runner/contract.ts`。
5. **启动/重启归 Playwright**：不要塞进 dev extension。
6. **一个回归一个用例**：低级 UI 错误必须落成可复现 case，而不是靠手测。
