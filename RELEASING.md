# 发布流程

## 版本规则

- 应用版本在根 `package.json`，tag 为 `vX.Y.Z`，两者必须一致；tag 只负责触发发布。
- SDK 版本在 `packages/sdk/package.json`，独立于应用版本，是否发布由它和 npm `latest` 的比较结果决定。
- SDK 只在有变化时 bump 并发布；没变化的 release 跳过 npm，因此 SDK 版本会跳号。
- 预发布 tag（`-beta` / `-rc`）不发布 SDK。

示例：

| Release         | SDK 变化 | `packages/sdk` 版本 | npm          |
| --------------- | -------- | ------------------- | ------------ |
| `v0.3.3`        | 有       | `0.1.1`             | 发布 `0.1.1` |
| `v0.3.4`        | 无       | `0.1.1`             | 跳过         |
| `v0.3.5`        | 有       | `0.1.2`             | 发布 `0.1.2` |
| `v0.4.0-beta.1` | 有       | `0.2.0`             | 跳过         |
| `v0.4.0`        | 有       | `0.2.1`             | 发布 `0.2.1` |

## 发版步骤

1. 本地跑 `pnpm verify` 和 `pnpm test:e2e`。
2. 修改根 `package.json` 版本。
3. 如果本次 SDK 有变化，bump `packages/sdk/package.json` 版本（patch 或 minor 即可，不必与应用版本相同）；没有变化则不要动。
4. 提交，打 tag `vX.Y.Z`，推送 tag。
5. GitHub Actions：
   - `verify`：校验 tag / 根版本、运行 `scripts/release-sdk.mjs`、typecheck / lint / build；
   - `sdk`：按判定发布 npm，并把 tarball 挂到 draft Release；
   - `build`：三平台打包并上传安装包；
   - `publish`：等 `build` 和 `sdk` 都成功后再公开 Release，并在 release notes 里标注 SDK 版本。
6. 如果 `sdk` 失败，Release 保持 draft；修复后重跑对应 tag 的 workflow。

## SDK 发布判定

`scripts/release-sdk.mjs` 在 `verify` 里运行，规则：

- 预发布 tag → 跳过；
- npm 上还没有 `@work-studio/sdk` → 发布；
- SDK 版本等于 npm `latest`：
  - 自 npm 当前版本的 `gitHead` 以来 `packages/sdk` 没有变化 → 跳过；
  - 有变化 → 失败，要求 bump 版本；
  - 没有 `gitHead` 时回退到上一个稳定 tag；
- SDK 版本不等于 npm `latest`：
  - 大于 `latest` → 发布；
  - 否则失败。

脚本会把 `publish` / `version` 写入 `GITHUB_OUTPUT`，供 `sdk` job 使用。

## npm 认证

SDK 通过 npm Trusted Publisher（OIDC）发布，不使用长期 token：

1. 在 npm 包设置里为 `@work-studio/sdk` 配置 Trusted Publisher：`Work-Agent/WorkStudio`、workflow 文件名 `release.yml`，并允许 `npm publish`；
2. workflow 的 `sdk` job 声明 `id-token: write`（已配置）；
3. 不要配置 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN`——同时存在会让 npm 走 token 而不是 OIDC。

要求 npm CLI ≥ 11.5.1（workflow 的 Node 24 自带版本满足）。provenance 只在公开源仓库生成：仓库私有时照常发布但不带 provenance，仓库转公开后自动附带 `--provenance`。

workflow 对已存在的 npm 版本会跳过 publish，便于重跑。

## 当前基线

`@work-studio/sdk@0.1.1` 已发布，npm 记录对应的 `gitHead` 是 `c481013`。下一次 release 从该提交开始比较 `packages/sdk` 的变化：没有变化就跳过，有变化则要求 bump SDK 版本。

## 手动检查

```bash
# 只判定，不发布（--tag 需指向已存在的 tag）
node scripts/release-sdk.mjs --tag v0.3.2

# 检查 npm 包内容
pnpm sdk:build
cd packages/sdk
npm pack --dry-run
```

## Release notes

`publish` job 会在 notes 末尾追加：

```text
SDK: `@work-studio/sdk@0.1.1` (published to npm)
```

或：

```text
SDK: `@work-studio/sdk@0.1.0` (unchanged)
```

重跑时已有 `SDK:` 行不会重复追加。
