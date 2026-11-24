# @workstudio/sdk

WorkStudio 插件 SDK。插件在独立仓库开发，通过 npm 安装本包，与宿主共用同一份契约。

## 安装

```bash
pnpm add @workstudio/sdk
```

公共入口导出 `definePlugin` / `locator`、`window.workStudio` 的 `WorkStudioBridge` 类型，以及插件契约类型（`ResourceAdapter` / `PluginContext` 等）。
页面只使用 `import '@workstudio/sdk/global'`，直接调用 `window.workStudio`；不再提供 `createPage` 页面封装。

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
import { definePlugin, locator } from '@workstudio/sdk';

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
import '@workstudio/sdk/global';

const ref = new URLSearchParams(location.search).get('ref') ?? '';
await window.workStudio.subscribe('workspace', ref);
await window.workStudio.command('docx', 'docx', 'insert', {
  at,
  text,
});
```

页面入口只有 `@workstudio/sdk/global`。资源订阅、设置订阅和保存都直接用 `window.workStudio` 的 `subscribe / command / onUpdate`。

地址约定由 SDK 生成，页面不能指定目标：

| 能力            | 地址                         |
| --------------- | ---------------------------- |
| 资源快照 / 变更 | `workspace/<ref>`            |
| 命令            | `<domain>/<domain>` + action |
| 设置            | `<domain>/settings`          |

## 5. 全局 bridge

页面入口只需要全局类型声明：

```ts
import '@workstudio/sdk/global';

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
| ② engine.js 的 `definePlugin` | `@workstudio/sdk` 根入口                                                                          |
| ③ 构建拆分                    | `workstudio-plugin` → `commands.json` / `api.json` / `api.d.ts`；`engine.js` 由插件自己的构建产出 |
| ④ 两条入口，一份实现          | 命令表：页面 `window.workStudio.command` / 助手 `command` / `bash`；宿主统一分发                  |
| ⑤ 数据接口                    | `ResourceAdapter`（`@workstudio/sdk`）                                                            |
| ⑥ 条目与 locator              | `Item` / `locator`                                                                                |
| ⑦ 路由归属                    | 宿主 `TransportRouter`：ref → 域 → adapter                                                        |
| ⑧ 生命周期                    | 宿主 `DomainRegistry` + `PluginLifecycle`                                                         |
| ⑨ 页面入口                    | `@workstudio/sdk/global` 的 `window.workStudio`                                                   |
| ⑩ 上下文                      | `PluginContext` 类型                                                                              |
| ⑪ 清单规则                    | `WorkStudioManifest` + `buildPlugin` 校验                                                         |

## 7. 构建

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
