# E2E 测试架构

测试分三层：共享用例、Playwright 隔离执行器、dev extension CDP 执行器。

```text
e2e/
├─ cases/                 # 共享用户路径（不 import Playwright）
├─ runner/
│  ├─ contract.ts         # E2ECase / E2EContext
│  ├─ registry.ts         # 用例注册与过滤
│  ├─ playwright-adapter.ts
│  ├─ cdp.ts              # 长连接 CDP 客户端
│  ├─ cdp-context.ts      # dev extension 的 E2EContext
│  ├─ run.ts              # CDP 执行器
│  └─ cli.ts              # 不经 pi 的本地跑法
├─ specs/                 # Playwright 薄壳 + playwright-only 用例
└─ support/               # 启动、fixture、dev renderer server
```

## 分工

| 场景                           | 执行器                             |
| ------------------------------ | ---------------------------------- |
| 开发时当前窗口验证             | `dev_test`（CDP，不启动 Electron） |
| 提交前 / CI 隔离回归           | Playwright                         |
| 冷启动 / 重启 / 数据根隔离     | Playwright（`playwright-only`）    |
| 打包产物 / 主进程 evaluate     | Playwright（`playwright-only`）    |
| 资源、设置、标签、路径、对话框 | 共享 case，两边都跑                |

共享 case 只依赖 `e2e/runner/contract.ts` 的 `E2EContext`。  
Playwright 和 CDP 各自实现点击、等待、截图，case 本身不感知执行器。

## dev extension

```text
dev_test({ case: "settings.open" })
dev_test({ tag: "dev" })
dev_test({ grep: "路径" })
dev_test({ all: true })
```

- 默认只跑 `tag=dev`；
- 默认拒绝 `mutating`，需要显式 `allowMutating: true`；
- `dev_test` 不启动/重启 dev 窗口，离线时先恢复窗口；
- 失败返回错误和截图 `/tmp/work-studio-dev-test-failure.png`。

不经 pi 的排查方式：

```bash
pnpm test:e2e:cdp --tag dev
pnpm test:e2e:cdp --case settings.open
pnpm test:e2e:cdp --grep 设置
```

## Playwright

```bash
# 全量隔离回归（提交前）
pnpm test:e2e

# 单文件 / 单用例 / 上次失败
pnpm test:e2e e2e/specs/resource.spec.ts
pnpm test:e2e -g "资源"
pnpm test:e2e:last

# renderer 走 Vite dev server
pnpm test:e2e:dev
pnpm test:e2e:dev:run e2e/specs/regressions.spec.ts
```

- 每个测试独立临时 data root；
- `isolated` project 负责 restart / workspace / theme；
- 其余共享用例和 playwright-only 用例在 `shared` project；
- 不用 `test:e2e` 做日常单点验证，用 `dev_test`。

## 新增用例

1. 在 `e2e/cases` 写共享 case，打 `dev` + `ci`；
2. 若需要冷启动 / 重启 / 数据根隔离，留在 `e2e/specs` 并打 `playwright-only`；
3. 主路径必须点击真实 UI，不能只调用 `appBridge.call`；
4. 断言用户可见结果：标题、页面、文件内容、路径文本；
5. 写操作使用 `mutating`，dev runner 默认不执行。

详细覆盖见 [COVERAGE.md](COVERAGE.md)。
