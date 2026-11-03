# E2E 基线

Playwright Electron，黑盒验证启动、数据根隔离与重启。

## 按需跑（默认）

Playwright 支持直接传文件 / 用例名；不要每次全量。

```bash
# 只跑一个 spec
pnpm test:e2e e2e/regressions.spec.ts

# 只跑匹配用例
pnpm test:e2e --grep "设置页"

# 只跑上次失败
pnpm test:e2e:last
```

## dev 模式跑

dev 模式 = renderer 走 Vite dev server（HMR），主进程 / preload 仍用
`electron-vite build` 的产物；Playwright 仍是 `_electron.launch`，可 evaluate 主进程。

```bash
# 第一次 / 主进程或 preload 改动后：build + dev 模式全量
pnpm test:e2e:dev

# 只跑一个 spec（会先 build，保证主进程产物最新）
pnpm test:e2e:dev e2e/regressions.spec.ts

# 已 build 过，直接按需跑，不再 build
pnpm test:e2e:dev:run e2e/regressions.spec.ts
pnpm test:e2e:dev:run -g "对话框"

# dev 模式只跑上次失败 / UI
pnpm test:e2e:dev:last
pnpm test:e2e:dev:ui
```

`E2E_DEV=1` 时 `e2e/global-setup.ts` 启动一个随机端口的 renderer
Vite server，测试进程通过 `ELECTRON_RENDERER_URL` 注入；不会启动第二个 Electron。

## 构建产物模式

```bash
pnpm build        # 源码变化后先构建
pnpm test:e2e     # 不重复 build
pnpm test:e2e:full
```

- 每个测试使用独立临时数据根，避免工作区、窗口状态、单实例串扰；
- 构建产物模式启动 `out/main/index.js`；dev 模式只替换 renderer URL；
- 测试不访问网络，不依赖真实模型。

## 当前覆盖

- 主窗口启动并加载壳层；
- 侧栏资源 / 插件 / 设置入口可见，并能在三者间切换；
- 同一数据根重启、切换工作区后恢复，且 Agent 跟随新工作区域；
- 通过 `views.open` 打开内置设置页；
- 通过 `views.openBrowser` 打开本地临时浏览器视图；
- 通过 `views.openResource` 打开工作区内的 Markdown 资源页；
- 文本编辑器修改后 `Ctrl+S` 保存回磁盘；
- 通过 `views.close` 关闭设置视图；
- 本地插件来源安装 / 卸载；
- 主题切换并在重启后保留；
- 多标签显示与标签激活；
- 助手视图加载与未配置状态；
- 助手会话标签跟随当前会话，而不是资源视图；
- 设置页命令经新桥可用；
- 对话框请求经 overlay 展示并可应答；
- Cmd/Ctrl+数字激活标签、Ctrl/Cmd+W 关闭标签；
- 设置页 / 插件页 provider 解析；
- 视图注册表 pin / move / 系统视图过滤；
- `appBridge` 暴露边界（assistant / 插件页暴露，外部 browser 页不暴露）；
- 核心契约：call 路由、state 回放、可视图事件 / 内部事件、请求中间件顺序与短路；
- 会话流：PiEventFrame 归约为 SessionStreamState、受约束增量、校验器拒绝非法载荷。

## Parity 矩阵

见 [PARITY.md](PARITY.md)。

## 重写时的原则

- 断言用户可见行为，不绑内部 IPC / 模块结构；
- 选择器优先 test id 或可访问角色；
- 固定 fixture，禁止真实 AI / 外网；
- 新架构切换后，同一套基线先跑通，再补全 parity 矩阵。
