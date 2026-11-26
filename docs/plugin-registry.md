# 插件注册表

官方注册表是 [Work-Agent/PluginRegistry](https://github.com/Work-Agent/PluginRegistry)。它是一个独立仓库：插件作者在自己的仓库发布自包含 zip，注册表只保存发现信息与完整性校验值。应用启动不联网，打开插件设置页或手动刷新时才读取注册表生成的 `index.json`。默认从 `https://raw.githubusercontent.com/Work-Agent/PluginRegistry/main/index.json` 读取；显式刷新会带缓存穿透参数，避免分支地址缓存导致列表滞后。网络请求使用偏好设置里的代理（支持 socks5）。

## 契约

```ts
interface Registry {
  schemaVersion: 1;
  entries: RegistryEntry[];
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  sha256: string;
  repo?: string;
  icon?: string;
  category?: string;
  tags?: string[];
  deprecated?: boolean;
  builtin?: boolean;
}
```

| 字段         | 约束                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `id`         | 小写字母 / 数字开头，只含 `a-z0-9._-`；必须与 zip 内 `workstudio.id` 一致 |
| `version`    | semver；必须与 zip 内 `package.json` 一致                                 |
| `source`     | `https` 的自包含 zip；本地回环允许 `http` 便于开发                        |
| `sha256`     | 64 位小写十六进制，固定具体产物                                           |
| `repo`       | 源码仓库，用于审计                                                        |
| `deprecated` | 不再推荐安装；应用隐藏入口，已安装实例不受影响                            |
| `builtin`    | 由注册表白名单注入；为 true 时随安装包分发，并在启动时播种到 `installed/` |

注册表仓库一个插件一个 `plugins/<id>.json`，CI 校验后生成确定性的 `index.json`；应用只读取 `index.json`，不直接访问单条文件。

## 应用侧

| 状态           | 行为                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| 启动           | 只读本地缓存，不联网                                                    |
| 打开插件设置页 | 无缓存立即刷新；缓存超过 1 小时后台刷新                                 |
| 刷新成功       | 覆盖缓存与 `fetchedAt`；条件请求命中 304 只更新时间                     |
| 刷新失败       | 保留上一份并标记 `stale`；无缓存则为空列表与可重试错误                  |
| 安装           | `catalog:<id>` 取条目 URL 与 sha256；下载后校验、解包、比对 manifest id |

- 缓存位于数据根的插件目录下，可随时丢弃；
- 目录地址默认为官方注册表，测试或开发可用本地 HTTP 覆盖；
- 应用不自动更新插件：目录版本高于已安装版本时只显示「可更新」；
- 注册表条目不写入安装记录，安装记录就是 `installed/<id>/package.json`；
- 内置插件 id 保留，注册表条目不得占用。

## 内置插件

`builtin` 不是条目字段，而是注册表白名单注入到 `index.json` 的结果。打包流程据此决定哪些插件随安装包分发：

```text
index.json 中 builtin: true
  ─► 打包脚本下载 source zip ─► 校验 sha256 ─► 解包到 out/plugins/<id>
  ─► 应用启动 ─► seedBuiltins 复制到数据根 plugins/installed/<id>
```

- 同步发生在打包阶段（`pnpm plugins:sync`，由 `package` / `make` / `release` 与 release workflow 调用），普通构建不联网；
- 每个包仍按 sha256 固定，构建与运行时都不信任未校验的 zip；
- 播种只向前：包版本高于已安装版本时覆盖，同版或用户已装的更新版本保留，不降级；
- 内置插件在侧栏不可卸载；`plugins/data/<id>` 与普通插件一样保留。

## 注册表 CI

- 校验字段、id 与文件名一致、id 唯一、semver、https zip、sha256 格式；
- 合并前人工 review 新插件；已有插件只改版本 / 哈希时，`repo` 与 `source` 主机不变可自动合并；
- 合并后由 CI 生成 `index.json`，作者不手改；
- 定时任务下载 zip 校验 sha256，失败显式报错；
- 第一方插件仓在 release 流程中自动更新条目，避免每次发版手工提 PR。

## 安全边界

插件代码在主进程以完整权限运行。注册表是分发渠道，合并条目等于为来源背书：

- 不接受会变化的下载地址；
- 新插件必须有可审计的源码仓库；
- 下架时删除条目或标记 `deprecated`；
- 应用安装前提示风险，不在后台静默安装。
