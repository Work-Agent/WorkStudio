# Parity 矩阵

| 领域      | 行为                              | 当前保障                 | 状态 |
| --------- | --------------------------------- | ------------------------ | ---- |
| 启动      | 主窗口启动、壳层加载              | `smoke.spec.ts`          | ✅   |
| 生命周期  | 同一数据根重启                    | `restart.spec.ts`        | ✅   |
| 工作区    | 切换工作区、重启恢复              | `workspace.spec.ts`      | ✅   |
| 导航      | 资源 / 插件 / 设置切换            | `navigation.spec.ts`     | ✅   |
| 资源      | 打开 Markdown 页面                | `resource.spec.ts`       | ✅   |
| 资源      | 文本编辑并保存回磁盘              | `resource-save.spec.ts`  | ✅   |
| 设置      | 打开内置设置页                    | `settings.spec.ts`       | ✅   |
| 视图      | 打开 / 关闭内容视图               | `view-lifecycle.spec.ts` | ✅   |
| 浏览器    | 打开本地临时页面                  | `browser.spec.ts`        | ✅   |
| next 核心 | call / state / event / middleware | `next-core.spec.ts`      | ✅   |
| next 会话 | 流式事件归约与校验                | `next-sessions.spec.ts`  | ✅   |
| 插件      | 安装 / 卸载 / 本地 zip            | —                        | ⬜   |
| 助手      | 会话 UI、prompt、stream、abort    | —                        | ⬜   |
| 布局      | 主题、标签、几何、拖拽预览        | —                        | ⬜   |
| 平台      | 快捷键、菜单、权限、窗口状态      | —                        | ⬜   |
| 迁移      | 旧 data root / ui-state / scene   | —                        | ⬜   |

## 原则

- 新增覆盖优先写用户可见行为；
- 每项至少有一条旧 `main` 基线，next 切换后跑同一套断言；
- 不能自动化的平台行为进入人工验收清单。
