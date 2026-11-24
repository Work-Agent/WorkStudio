# E2E 覆盖矩阵

共享 case 位于 `e2e/cases`，由 CDP runner 与 Playwright 共用；启动/重启类只放在 Playwright spec。

## 运行模式

| 模式            | 命令                               | 说明                      |
| --------------- | ---------------------------------- | ------------------------- |
| dev extension   | `dev_test({ tag: "dev" })`         | 常驻 dev 窗口，CDP        |
| CDP CLI         | `node e2e/runner/cli.ts --tag dev` | 不经过 pi                 |
| Playwright 隔离 | `pnpm test:e2e`                    | 临时 data root + 构建产物 |

## 共享 case（43）

| 领域   | 用户路径 / 契约                     | case                   |
| ------ | ----------------------------------- | ---------------------- |
| 窗口   | 默认 1440×900、标题、三栏、系统视图 | `window.defaults`      |
| 布局   | 标题栏收起侧栏 / 助手，快照同步     | `shell.panel-toggle`   |
| 布局   | 布局 drag preview / 提交            | `shell.layout`         |
| 布局   | `ui-state.json` 持久化              | `shell.layout-persist` |
| 布局   | 捕获层 pointerup 结束拖拽           | `shell.capture`        |
| 布局   | TitleBar 主题切换                   | `shell.theme-toggle`   |
| 导航   | 标题栏设置入口                      | `navigation.sidebar`   |
| 设置   | 打开单页设置并渲染卡片              | `settings.open`        |
| 设置   | 标题栏打开设置、展开卡片            | `settings.sidebar`     |
| 设置   | 所有卡片可展开渲染                  | `settings.cards`       |
| 设置   | 主题 source / 缩放                  | `settings.appearance`  |
| 设置   | 全局偏好写入                        | `settings.preferences` |
| 设置   | 供应商与模型目录                    | `settings.models`      |
| 视图   | 打开 / 关闭内容视图                 | `view.lifecycle`       |
| 标签   | 多标签、激活                        | `view.tabs`            |
| 标签   | 固定 / 移动 / 左右关闭 / 全部关闭   | `tabs.actions`         |
| 标签   | 批量关闭保留欢迎页                  | `tabs.bulk`            |
| 标签   | 关闭其他保留锚点，未知锚点不误删    | `tabs.close-others`    |
| 路径   | 设置地址不泄露本机路径              | `path.display`         |
| 浏览器 | 打开临时浏览器视图                  | `browser.open`         |
| 浏览器 | 页面内跳转 / 新窗口临时标签         | `browser.links`        |
| 站点   | 同一 URL 复用标签                   | `site.open`            |
| 对话框 | overlay 展示并应答                  | `dialog.overlay`       |
| 对话框 | 输入值提交                          | `dialog.input`         |
| 对话框 | 选择项返回                          | `dialog.select`        |
| 通知   | 新增 / 关闭                         | `shell.notices`        |
| 插件   | 插件设置页入口                      | `plugin.entry`         |
| 插件   | 内置插件安装、打开、重载            | `plugin.lifecycle`     |
| 插件   | 本地目录安装 / 激活 / 卸载          | `plugin.install`       |
| 插件   | HTML 文件认领并打开插件内容页       | `plugin.content`       |
| 插件   | 插件命令写回资源                    | `plugin.save`          |
| 插件   | 插件技能进入 agent 技能目录         | `plugin.skills`        |
| 欢迎   | 唯一欢迎页、空标签自动恢复          | `welcome.page`         |
| 助手   | workStudio、技能资源                | `assistant.bridge`     |
| 助手   | 会话聚合形状                        | `assistant.sessions`   |
| 助手   | thinking levels                     | `assistant.thinking`   |
| 助手   | 浮动模式 / 几何提交                 | `assistant.floating`   |
| Agent  | 扩展 / 工具 / 提示词 / 主题资源     | `agent.resources`      |
| 工作区 | 搜索资源就绪与目录读取              | `workspace.search`     |
| 工作区 | 注册表当前项与列表                  | `workspace.registry`   |
| 工作区 | 切换并恢复                          | `workspace.switch`     |

## 真实模型（可选）

`pnpm test:e2e:real` 自动读取本机 WorkStudio 的 `auth.json / models.json / settings.json`；未配置模型时 skip。凭证复制到临时数据根，不进入仓库。

## Playwright 独享

| 用户路径 / 契约                | spec                        |
| ------------------------------ | --------------------------- |
| 同一数据根重启恢复工作区与布局 | `e2e/specs/restart.spec.ts` |

## 人工验收（无法可靠自动化的平台行为）

- 原生应用菜单（macOS / Windows 角色菜单、快捷键）
- 系统文件选择器、系统文件管理器打开路径
- OAuth 外部授权页回调（需要真实 provider）

## 说明

- 旧套件的 21 条用户路径已全部迁移；URA 绑定 / 资源诊断两条旧用例随 URA 退役，替换为 `shell.layout` 与 `workspace.search`。
- 新增测试直接使用新 Domain / Resource 地址；`e2e/support/work-studio-shim.ts` 只保留路径断言的翻译，不进入生产代码。
