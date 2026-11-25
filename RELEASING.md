# 发布流程

## 版本规则

- 应用版本在根 `package.json`，tag 为 `vX.Y.Z`，两者必须一致。
- SDK 版本在 `packages/sdk/package.json`，**跟随 release，但只在该 SDK 变化时发布**。
- SDK 没变化的 release 不发布 SDK，因此 SDK 版本会跳号。
- 预发布 tag（`-beta` / `-rc`）不发布 SDK。
- SDK 版本必须是 release tag 的子集；不会出现 npm 上存在、但仓库里没有对应 release 的 SDK 版本。

示例：

| Release         | SDK 变化 | `packages/sdk` 版本 | npm          |
| --------------- | -------- | ------------------- | ------------ |
| `v0.3.3`        | 有       | `0.3.3`             | 发布 `0.3.3` |
| `v0.3.4`        | 无       | `0.3.3`             | 跳过         |
| `v0.3.5`        | 有       | `0.3.5`             | 发布 `0.3.5` |
| `v0.4.0-beta.1` | 有       | `0.4.0-beta.1`      | 跳过         |
| `v0.4.0`        | 有       | `0.4.0`             | 发布 `0.4.0` |

## 发版步骤

1. 本地跑 `pnpm verify` 和 `pnpm test:e2e`。
2. 修改根 `package.json` 版本。
3. 如果本次 SDK 有变化，把 `packages/sdk/package.json` 版本改成**同一个版本**；没有变化则不要动。首次发布也算变化：把 SDK 版本设成下一次 release tag。
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
- npm 上还没有 `@work-studio/sdk` → 首次发布，SDK 版本必须等于 tag；
- SDK 版本等于 npm `latest`：
  - 自上一个稳定 tag 以来 `packages/sdk` 没有变化 → 跳过；
  - 有变化 → 失败，要求 bump 版本；
- SDK 版本不等于 npm `latest`：
  - 必须大于 `latest` 且等于 release tag → 发布；
  - 否则失败。

脚本会把 `publish` / `version` 写入 `GITHUB_OUTPUT`，供 `sdk` job 使用。

## npm 认证

首次发布前：

1. 确认 `@work-studio` scope 归项目所有；
2. 在 npm 创建 granular access token，允许发布 `@work-studio/sdk`；
3. 在 GitHub 仓库 secrets 中添加 `NPM_TOKEN`。

首次发布由下一次 release 的 workflow 完成，本地不手动 publish；workflow 对已存在的版本会跳过，便于重跑。

如果仓库是公开的，可以在 `npm publish` 上追加 `--provenance`；仓库仍是私有时先不要加，避免 provenance 校验阻碍首次发布。

## 首次发布

当前 `@work-studio/sdk` 尚未出现在 npm。下一次 release 时：

1. 把 `packages/sdk/package.json` 版本改成下一个 release tag（例如 `0.3.3`）；
2. 正常打 tag；
3. workflow 会识别为首次发布并发布 `0.3.3`。

之后 SDK 没变化的 release 不再发布。

## 手动检查

```bash
# 只判定，不发布
GITHUB_REF_NAME=v0.3.3 node scripts/release-sdk.mjs

# 检查 npm 包内容
pnpm sdk:build
cd packages/sdk
npm pack --dry-run
```

## Release notes

`publish` job 会在 notes 末尾追加：

```text
SDK: `@work-studio/sdk@0.3.3` (published to npm)
```

或：

```text
SDK: `@work-studio/sdk@0.3.3` (unchanged)
```

重跑时已有 `SDK:` 行不会重复追加。
