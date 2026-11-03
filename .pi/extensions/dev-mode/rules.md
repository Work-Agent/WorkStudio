# Live Dev —— 常驻 dev 窗口 + 本轮定向验证

> dev 窗口（CDP 9222）的生命周期由扩展管理：开启时自动确保就绪（在线复用 / 离线拉起），
> 关闭时自动回收（杀进程、清临时文件）。**无需执行任何拉起/清理流程**，专注开发与验证。

## 客户端纪律

1. **复用唯一常驻 dev 窗口**——绝不重复拉起第二个客户端；渲染层改动靠 HMR 自动生效。
2. **保持联通**——窗口离线（崩溃 / HMR 失效）时直接后台拉起恢复，无需询问：
   ```bash
   nohup env WA_DEBUG_PORT=9222 pnpm dev > /tmp/work-studio-dev.log 2>&1 &
   ```
   可随时 `curl -s -m 1 http://127.0.0.1:9222/json/list` 自查联通；启动失败看 `/tmp/work-studio-dev.log`。
3. **必要的重启直接执行，无需确认**——改了主进程（`src/main.ts` / `src/preload.ts`）或依赖时，
   同一条命令里杀掉再拉起：
   ```bash
   pkill -9 -f "[e]lectron-(forge|vite)"; nohup env WA_DEBUG_PORT=9222 pnpm dev > /tmp/work-studio-dev.log 2>&1 &
   ```
   重启后确认 CDP 联通即可。守卫对重启流程（同命令含 kill + 拉起）自动放行。

## 验证分层

开发中只验证本轮改动；静态检查在改动收敛后跑。验证强度与改动风险匹配：
小 UI 调整截图目视；交互规则变更优先补共享 case，再用 `dev_test` 跑该 case。

| 层           | 跑法                                           | 说明                                                                                          |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 静态检查     | `pnpm typecheck` / `pnpm lint`                 | 每轮改动结束前（快）                                                                          |
| dev 窗口联通 | `curl -s -m 1 http://127.0.0.1:9222/json/list` | 状态自查                                                                                      |
| 页面目视     | `dev_shot` 工具                                | CDP 截图保存 PNG（默认 `/tmp/work-studio-shot.png`），用 read 查看；`eval` 可先操作出目标状态 |
| 开发时 e2e   | `dev_test` 工具                                | 在常驻窗口执行共享 case，默认 `tag=dev`；失败返回截图                                         |
| 提交前回归   | `pnpm test:e2e`                                | Playwright 隔离进程 + 临时 data root；启动/重启/破坏性用例归这里                              |

## 用例与执行器分工

- 共享 case 在 `e2e/cases`，只依赖 `e2e/runner/contract.ts` 的 `E2EContext`，不 import Playwright。
- `dev_test` 用 CDP 在常驻 dev 窗口执行，不启动 Electron、不启动 Playwright。
- Playwright 负责冷启动、重启、隔离数据根、打包产物等 `playwright-only` 用例。
- 新增 UI 回归：先写共享 case，打 `dev` + `ci` 标签；启动/重启类只打 `playwright-only` + `ci`。
- dev 窗口离线时 `dev_test` 不会自动拉起，先恢复 dev 窗口；不要在 dev_test 里做重启。

## 探针写法约定

- 优先用 `dev_test` 跑共享 case；只有纯目视检查才用 `dev_shot`
- 预操作 + 截图：调用 `dev_shot` 工具（`eval` 里点击/等待，`waitMs` 等渲染），再 `read` 保存的 PNG
- 锚点用 `data-testid`（如 `chat-tabs` / `doc-tabs` / `assistant-float` / `session-manager-row` / `sidebar-toggle`），
  不依赖脆弱 class 层级
- 需要特定窗口状态：先在 `eval` 里操作出该状态再截图（点击 UI，或直接调用页面内的 store）

## 命令速查

| 命令                               | 用途                                                              |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| `dev_shot` 工具                    | 截取 dev 窗口当前界面（CDP，可以 `eval` 预操作、`path` 指定输出） |
| `dev_test` 工具                    | 在常驻窗口执行共享 e2e case（CDP，不启动 Playwright）             |
| `pnpm test:e2e`                    | Playwright 隔离回归（提交前）                                     |
| `node e2e/runner/cli.ts --tag dev` | 不经过 pi 的 CDP 跑法，排查扩展问题用                             |
| `WA_DEVTOOLS=1 pnpm dev`           | 手动打开 DevTools（默认关，调试用）                               |
| `pnpm typecheck`                   | 类型检查                                                          |
| `pnpm lint`                        | oxlint + oxfmt 检查                                               |
| `curl -s localhost:9222/json/list` | 查看 dev 窗口 CDP 状态                                            |
| `pkill -9 -f "[e]lectron-(forge    | vite)"`                                                           | 停 dev 窗口（扩展关闭模式时会自动回收） |

## 目录

```
.pi/extensions/dev-mode/     # 本扩展（已入仓；.pi 其余内容仍忽略）
├── index.ts                 # /dev、资源准备与回收、dev_shot / dev_test、规则注入
└── rules.md                 # 模式开启期间注入 system prompt 的开发规则
e2e/
├── cases/                   # 共享 case（dev + Playwright）
├── runner/                  # 契约、CDP runner、Playwright adapter
├── specs/                   # Playwright 薄壳 + Playwright-only 用例
└── support/                 # 启动、fixture、dev server
src/                         # 项目源代码（main / preload / renderer / shared）
docs/architecture.md         # 架构设计文档（Agent 域 + 页面域）
```
