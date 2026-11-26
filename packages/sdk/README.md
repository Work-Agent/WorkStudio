# @work-studio/sdk

WorkStudio 插件 SDK。插件在独立仓库开发，通过 npm 安装本包，与宿主共用同一份契约。

## 安装

```bash
pnpm add @work-studio/sdk
```

### 版本策略

- SDK 版本跟随 WorkStudio release：**只在该 SDK 最后一次变化的那次 release 发布**；
- 没有变化的 release 不发布 SDK，所以版本会跳号；
- 预发布 tag（`-beta` / `-rc`）不发布 SDK；
- 插件应锁定当前验证过的版本（例如 `@work-studio/sdk@0.3.3`），不要假设每个 app release 都有对应的 SDK 版本；
- 宿主 app 的 release notes 会标注它对应的 SDK 版本；
- 1.0 之前不承诺独立 semver；SDK 兼容性以 WorkStudio 实际支持的契约为准。

公共入口导出 `definePlugin` / `locator`、`window.workStudio` 的 `WorkStudioBridge` 类型，以及插件契约类型（`ResourceAdapter` / `PluginContext` 等）。
页面只使用 `import '@work-studio/sdk/global'`，直接调用 `window.workStudio`；不再提供 `createPage` 页面封装。

## 1. 静态清单（package.json）

```jsonc
{
  "name": "@acme/plugin-docx",
  "version": "1.0.0",
  "type": "module",
  "exports": { "./workstudio": "./dist/engine.js" },
  "workstudio": {
    "id": "docx",
    "label": "Word 文档",
    "pages": { "content": "dist/page/index.html" },
    "claims": [{ "extensions": ["docx"], "priority": 10 }],
    "skills": ["dist/skills/docx"],
  },
}
```

> 清单字段规范写法是 `workstudio`（全小写）；`workStudio` 是 preload 注入的全局对象。构建工具兼容 `workStudio` 别名，但建议统一用 `workstudio`。

## 2. 动态引擎

```ts
import { definePlugin, locator } from '@work-studio/sdk';

export const workstudio = definePlugin({
  resources: {
    docx: {
      read: async (ref) => [{ locator: 'docx:para:12', text: '…' }],
      grep: async (ref, query) => [{ locator: 'docx:para:12', snippet: '…' }],
    },
  },
  commands: {
    'docx.insert': {
      summary: '在指定段落插入文本',
      args: {
        at: locator('docx:para'),
        text: { type: 'string', required: true },
      },
      run: async ({ ref, at, text }, ctx) => {
        // 写入由命令实现；完成后通知同一 ref 的订阅者
        ctx.changed(ref, 'content');
        return { changed: at };
      },
    },
  },
  lifecycle: { activate, deactivate },
});
```

## 3. 命令与技能

命令只有一份实现：`definePlugin({ commands })` 是运行期事实源；`workstudio-plugin` 从它生成 `commands.json` / `api.json` / `api.d.ts`。宿主激活时读取 `commands.json`，校验静态描述与动态实现完全对齐，再把同一个命令地址登记到 `DomainRegistry`。

因此同一命令天然同时具备两条调用路径：

| 调用方     | 入口                                                    |
| ---------- | ------------------------------------------------------- |
| 页面 / IPC | `window.workStudio.command(...)`                        |
| Agent 工具 | `command` / `bash` → `DomainRegistry.dispatchCommand()` |

`skills` 只列技能目录（相对插件根），不写名称、描述或命令；这些都在 `SKILL.md` 的 frontmatter / 正文里。插件技能默认不进入模型上下文，`agent/skills` 的 `setActive` 选中后才按需注入，适合命令很多、需要把说明拆成技能包的插件。构建时会校验目录、`SKILL.md` 与 frontmatter。

## 4. 页面

```ts
import '@work-studio/sdk/global';

const ref = new URLSearchParams(location.search).get('ref') ?? '';
await window.workStudio.subscribe('workspace', ref);
await window.workStudio.command('docx', 'docx', 'insert', {
  at,
  text,
});
```

页面入口只有 `@work-studio/sdk/global`。资源订阅、设置订阅和保存都直接用 `window.workStudio` 的 `subscribe / command / onUpdate`。

地址约定由 SDK 生成，页面不能指定目标：

| 能力            | 地址                         |
| --------------- | ---------------------------- |
| 资源快照 / 变更 | `workspace/<ref>`            |
| 命令            | `<domain>/<domain>` + action |
| 设置            | `<domain>/settings`          |

## 5. 全局 bridge

页面入口只需要全局类型声明：

```ts
import '@work-studio/sdk/global';

const off = window.workStudio.onUpdate((update) => {
  if (update.domain === 'workspace' && update.resource === 'file:///demo.md') {
    console.log(update);
  }
});
const snapshot = await window.workStudio.subscribe(
  'workspace',
  'file:///demo.md',
);
await window.workStudio.command('shell', 'windows', 'focus', { id: 'main' });
off();
window.workStudio.unsubscribe('workspace', 'file:///demo.md');
```

## 6. 与架构图看板的对应

| 看板                          | SDK / 宿主位置                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| ① package.json 静态声明       | `WorkStudioManifest` + 本 README                                                                  |
| ② engine.js 的 `definePlugin` | `@work-studio/sdk` 根入口                                                                         |
| ③ 构建拆分                    | `workstudio-plugin` → `commands.json` / `api.json` / `api.d.ts`；`engine.js` 由插件自己的构建产出 |
| ④ 两条入口，一份实现          | 命令表：页面 `window.workStudio.command` / 助手 `command` / `bash`；宿主统一分发                  |
| ⑤ 数据接口                    | `ResourceAdapter`（`@work-studio/sdk`）                                                           |
| ⑥ 条目与 locator              | `Item` / `locator`                                                                                |
| ⑦ 路由归属                    | 宿主 `TransportRouter`：ref → 域 → adapter                                                        |
| ⑧ 生命周期                    | 宿主 `DomainRegistry` + `PluginLifecycle`                                                         |
| ⑨ 页面入口                    | `@work-studio/sdk/global` 的 `window.workStudio`                                                  |
| ⑩ 上下文                      | `PluginContext` 类型                                                                              |
| ⑪ 清单规则                    | `WorkStudioManifest` + `buildPlugin` 校验                                                         |

## 7. 模型供应商 OAuth

模型供应商是 agent 域的资源，插件页不需要也不应该接触 `auth.json`：

| 地址                  | 形态                   |
| --------------------- | ---------------------- |
| `agent/providers`     | 供应商目录投影         |
| `agent/provider/<id>` | 单个供应商的配置与认证 |

凭证由主进程持有，页面不参与：

- 大厂 OAuth：`agent/provider/<id>.login` 打开授权页，provider 回调本机回环，主进程换 token 后写入密钥库；
- 自有服务：`agent/providers.openLogin` 打开供应商声明的 `loginUrl`（带 `redirect_uri` + `state`），登录成功后 302 回本机，主进程校验后写入；
- 设置页的 API Key 走 `agent/provider/<id>.configureApiKey`；
- 插件写凭证走 `ctx.credentials.write`（清单 `credentials` 声明范围）。

网页标签不注入 `window.workStudio`，也没有任何凭证命令；供应商快照只返回 `ProviderInfoView`（是否已配置、认证来源等）。

## 8. 构建

```bash
# engine.js 由插件自己的构建（Vite / tsc）产出；本命令只抽取静态部分
pnpm workstudio-plugin .
```

产物与清单字段对应：

| 产物            | 内容                           | 读者                 |
| --------------- | ------------------------------ | -------------------- |
| `engine.js`     | `run` 与数据接口               | 宿主激活后           |
| `commands.json` | 参数、摘要、退出码（构建产物） | 宿主激活时校验并合并 |
| `api.json`      | 运行期参数校验                 | 页面加载后           |
| `api.d.ts`      | 页面类型                       | 页面编译期           |
