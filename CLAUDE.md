# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WorkStudio 是以文件为中心的桌面工作台（Electron）：主进程持有状态与运行时，渲染层只消费投影并发送意图；会话交给 pi，资源由 URA 统一解释。行为准则见 AGENTS.md（文档规范、命名规范、改动后自检）；本文件补充常用命令与架构要点。

## 常用命令

| 任务 | 命令 |
| --- | --- |
| 安装 | `pnpm install`（Electron 二进制由 postinstall 下载） |
| 开发 | `pnpm dev`（Vite HMR） |
| 编译 | `pnpm build`（产物到 `out/`，不打包） |
| 类型检查 | `pnpm typecheck` |
| Lint | `pnpm lint`（oxlint + oxfmt --check）；修复用 `pnpm lint:fix` |
| CI 同款检查 | `pnpm verify` = typecheck → lint → build |

**改完代码（非纯 `docs/**` / `*.md`）必须跑 `pnpm verify`，不通过不提交、不宣称完成**；格式问题先 `pnpm lint:fix`。失败若确认与本次改动无关，回复里指出是哪一步、什么错误。

环境：Node ≥ 22.12，pnpm ≥ 12。中国大陆网络下载 Electron 慢可设镜像（`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）或代理，`pnpm install` 前生效；二进制缺失（`node_modules/electron/path.txt` 为空）补跑 `node node_modules/electron/install.js`。

### E2E

e2e 分三层：共享用例（`e2e/cases/`，只依赖 `e2e/runner/contract.ts` 的 `E2EContext`，不 import Playwright）、Playwright 隔离执行器、CDP 执行器。

```bash
# 针对正在运行的 dev 窗口（不启动/重启 Electron，需 dev 已在跑）
pnpm test:e2e:cdp --tag dev            # 日常单点验证首选
pnpm test:e2e:cdp --case settings.open # 单个用例
pnpm test:e2e:cdp --grep 设置           # 按标题过滤

# 隔离回归（提交前；每个用例独立临时 data root）
pnpm test:e2e                          # 全量
pnpm test:e2e -g "资源"                 # 按用例名过滤
pnpm test:e2e:last                     # 上次失败重跑
pnpm test:e2e:dev e2e/specs/shared.spec.ts  # renderer 走 Vite dev server
```

- 改 UI / 交互后按需跑 e2e；CI 不含 e2e，CI 绿不能代替 e2e 通过。
- 用例标签：`dev` / `ci` / `mutating`（写操作，CDP 默认拒绝，需 `--allow-mutating`）/ `playwright-only`（冷启动 / 重启 / 数据根隔离，只在 Playwright 跑）。
- 新增用例：共享路径写在 `e2e/cases/` 打 `dev`+`ci`；需要冷启动 / 重启的留在 `e2e/specs/` 打 `playwright-only`。主路径必须点真实 UI，断言用户可见结果（标题、页面、文件内容）。

### 打包与发版

- `pnpm package` 出未压缩应用目录，`pnpm make` 出当前平台安装包；产物到 `dist/`，不进版本库。
- 发版由 tag 触发，tag 版本必须与 `package.json` 的 `version` 一致；tag 名含 `-` 视为 prerelease。

## 架构

三段式 Electron 构建（`electron.vite.config.ts`），每段各有约束：

- **main**：ESM bundle 到 `out/main/index.js`，依赖全部打入（pi SDK 是 ESM-only，`externalizeDeps: false`）。
- **preload**：多入口、单文件 CJS（sandbox 的 WebContentsView 只接受 CJS 且无相对 require）；通道常量构建期内联，`src/shared/channels.ts` 是唯一事实源。
- **renderer**：多页面，每个页面独立 HTML 入口。

### 主进程四层（`src/main/`，依赖单向向下）

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Runtime | `src/main/runtime/` | DomainRegistry · Pipeline · Dispatcher · Views · Providers · Native · Layout · Dialogs——跨领域机制，不承载业务状态 |
| Domains | `src/main/domains/` | 业务状态、命令、订阅与推送；一个 domain 一个文件 |
| Modules | `src/main/modules/` | 实现层（agent · ura · resources · sessions · lists · plugins · browser · harness · updates 等），由 domain 调用 |
| Infrastructure | `src/main/infrastructure/` | net · repo · preferences · paths · logging 适配层 |

`src/main/app.ts` 是组合根：装配 domain / provider / IPC / 窗口与进程生命周期。没有 Capability 类、controller 或生命周期接口。Domain 不持 Electron / Node 句柄；Infrastructure 不反向依赖业务；渲染层不 import 主进程。

### Domain / Resource 通讯模型

- 订阅、命令、推送都以 `(domain, resource)` 为最小单位；全量清单见 docs/architecture.md 第四节。
- Resource 接口：`snapshot`（可序列化当前值）、`command`（返回 `{ ok, data }` 或错误）、`notify`（无回执）、`publish` / `patch` / `event`（推送帧）。
- 渲染层只用 `window.workStudio`（`subscribe` 返回 snapshot 并建立后续推送，`command` / `notify` / `onUpdate`）；资源页 / 插件页只有受限的 `window.extension`；浏览器页只有最小 `window.browser`。页面无 Node、无裸 IPC。
- 单写者：渲染层不直接改主进程状态，只发意图。不存在的 domain / resource / action 返回明确错误，不静默降级。

### URA 资源管道（`src/main/modules/ura/`）

```
ref（来源身份 scheme://authority/path）
  → transport（认 scheme；内建仅 file / http / https）→ RawContent{mime, bytes}
  → 绑定 (transport, mime) → codec（解释实现）→ 文档
  → 绑定 (transport, mime, codec) → presenter / store / sidecar
```

- 读写同一门面（read / write / edit / grep / find / ls / query）；写路径：定位 → 编码最小补丁 → 来源提交；写冲突保留草稿、不覆盖原文件。
- 任一环缺失降级 raw 并记录降级点；agent 读取走 sidecar 出口（文本 / schema），不扫文件系统。
- 用户绑定覆盖默认绑定，写应用数据目录。

### 插件（`src/plugins/` + `src/main/modules/plugins/`）

插件填管道的段：注册 transport / codec / store / consumer / presenter / sidecar、列表 provider、动作，可自带资源页与设置页。

- 清单：`package.json` 的 `workstudio` 字段（id / label / icon / page / settings / apiVersion），`exports["./ura"]` 指向 ESM 注册入口，模块求值即注册（SDK 在 `src/main/modules/ura/sdk.ts`）。
- 内置插件在 `src/plugins/`（markdown-viewer、html-viewer、text-editor、docx / xlsx / pptx），构建时拷贝到 `out/plugins`，dev 扫 `src/plugins`，两处必须同形。
- `PLUGINS.md` 是可安装清单——**编译期资产**，构建时解析内联进主进程与设置页，写错则构建失败；运行期不读它。改清单后需重新构建（dev 模式下改动触发主进程重载）。
- 安装：远程 zip 必须带 sha256；下载 → staging → 校验 → 解压 → 验证 manifest → 原子替换 `installed/<id>/`。安装与加载分别报告；加载失败保留安装记录，可单独重载。

### 浏览器旁路（`src/main/modules/browser/`）

在线网页不进 URA 管道：WebContentsView 直接导航，所有网页标签共享一个浏览器 session。白名单域的页面由注入提取（Readability 正文 + 可访问性结构）转 Markdown 落到 `sites/<domain>/`，进站点集合与资源地图；站点条目打开的是实时网页。自动化走 `webContents.debugger` 的 CDP + 注入提取，只暴露给侧车（`browser_*` 工具），不给页面或插件。

### 会话与 Agent（`src/main/modules/agent/` + `sessions/`）

- 会话真相在 pi（`@earendil-works/pi-coding-agent`）：消息与轮次由 pi 写入会话 JSONL；WorkStudio 只持投影（SessionsService 做列表、流式投影、任务状态）。助手视图只消费 sessions domain，不直接访问 AgentHost。
- 内置技能在 `src/skills/`（如 office-gen）。
- 状态三级作用域：App（模型 / 凭证 / 插件 / 全局设置）· Workspace（资源 / 列表 / scene / 会话索引）· Session（pi runtime / 消息 / 上下文）。
- 全部状态存应用数据根（`settings.json`、`models.json`、`auth.json`、`workspaces/<wsId>/`（workspace.json / scene.json / sessions/ / sites/）、`plugins/`、`skills/`）；不读写 `~/.pi` 或真实工作区的 `.pi`。

### 渲染层（`src/renderer/`）

- `pages/`：shell（壳层：标题栏 + 侧栏 + 资源面板 + 内容标签，DOM 只画壳层，内容由原生视图承载）、assistant、overlay（对话框 / 通知）、settings（单页卡片）、welcome。
- `shared/`：跨页面 workStudio 桥封装、domain hook、共享样式。
- 每个页面只订阅自己消费的 resource、自管本地状态；没有统一全局状态层。
- 布局由主进程根据窗口尺寸与 scene 计算，DOM 只消费矩形与 CSS 变量；scene（`scene.json`）是唯一持久现场，拖拽只是 preview，提交才写 scene。
- 侧栏列表统一走 provider → snapshot 管道（`src/main/modules/lists/`），渲染层只消费快照；单组失败只标记该组，其他组继续。

跨进程契约类型统一放 `src/shared/`（ura.ts、lists.ts、channels.ts、types.ts、view-bus.ts 等）。

## 关键约定

- **判别字段统一用 `type`，不用 `kind`**：`sourceType`、`viewType`、`projection.type` 等取值用短名词；对象已有 `type` 时子类型字段用 `<domain>Type`（如 `dialogType`）。
- **文档**：`README.md`（需求与重点模块设计，中文）与 `README.en.md`（英文镜像，章节号一一对应、内容同步改）讲需求；`docs/architecture.md` 讲系统化设计。禁止 changelog 式叙述（不写「现状问题 / 本次修改 / 已移除」）；设计变更直接写成最终设计。设计正文不出现文件路径、目录树、实现类名与函数名（契约级 TypeScript 类型与契约级名字例外；README 的「开发」章例外）。
- 运行期不展示完整本机路径（地址栏用逻辑地址或相对路径）。
- 不执行项目目录里未安装的代码（安装即信任）。
