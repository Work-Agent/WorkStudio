# E2E 覆盖矩阵

当前 e2e 只保留迁移后的共享 case：`e2e/cases` 由 CDP 与 Playwright 共用。
旧框架 / 旧设置页 / 旧路径兼容 spec 已删除，后续按新 UI 逐步补回。

## 运行模式

| 模式            | 命令                               | 说明                                  |
| --------------- | ---------------------------------- | ------------------------------------- |
| dev extension   | `dev_test({ tag: "dev" })`         | 常驻 dev 窗口，CDP                    |
| CDP CLI         | `node e2e/runner/cli.ts --tag dev` | 不经过 pi，排查扩展问题               |
| Playwright 隔离 | `pnpm test:e2e`                    | 临时 data root + 构建产物，提交前回归 |

## 共享 case

| 领域   | 用户路径/行为                     | case                    |
| ------ | --------------------------------- | ----------------------- |
| 导航   | 标题栏设置入口                    | `navigation.sidebar`    |
| 设置   | 打开单页设置并渲染卡片            | `settings.open`         |
| 设置   | 标题栏打开设置、展开卡片          | `settings.sidebar`      |
| 视图   | 打开并关闭设置视图                | `view.lifecycle`        |
| 标签   | 多标签、激活标签                  | `view.tabs`             |
| 路径   | `settings://home`，不泄露本机路径 | `path.display`          |
| 浏览器 | 打开临时浏览器视图                | `browser.open`          |
| 浏览器 | 页面内跳转 / 新窗口临时标签       | `browser.links`         |
| 站点   | 同一 URL 复用标签                 | `site.open`             |
| 对话框 | overlay 展示并应答                | `dialog.overlay`        |
| 插件   | 插件配置页入口                    | `plugin.entry`          |
| 欢迎   | 唯一欢迎页、空标签自动恢复        | `welcome.page`          |
| 助手   | workStudio、技能资源              | `assistant.bridge`      |
| 设置   | 模型供应商 / 模型目录             | `settings.models`       |
| 标签   | 批量关闭保留欢迎页                | `tabs.bulk`             |
| 资源   | 诊断资源状态                      | `resources.diagnostics` |

## 待补

- 助手真实 prompt / stream / abort / 会话切换
- 模型配置登录与会话模型切换
- 设置卡片的写操作（存储、工作区、插件安装、扩展安装、技能、偏好）
- 插件页内容投递、编辑保存、插件设置持久化
- 资源树真实点击、保存、冲突
- 标题栏工作区菜单、主题 / 助手开关
