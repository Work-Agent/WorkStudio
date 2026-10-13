# WorkStudio

基于 Electron + Vite + TypeScript 的桌面应用，使用 electron-vite 构建、electron-builder 打包。

## 环境要求

- Node.js >= 22.12
- pnpm（推荐 12+）

## 快速开始

安装依赖：

```bash
pnpm install
```

若首次安装时 Electron 二进制下载缓慢或失败，可通过代理下载：

```bash
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
export ELECTRON_GET_USE_PROXY=true
pnpm install
```

也可以改用镜像（无需代理）：

```bash
# 临时生效（本次安装）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm install
# 永久生效：写入 ~/.npmrc（pnpm 同样读取）
# echo 'electron_mirror=https://npmmirror.com/mirrors/electron/' >> ~/.npmrc
```

若依赖集大幅变动（增减打包/构建工具类依赖）后出现 `Error: Electron uninstall`、
或 `node_modules/electron/path.txt` 为空，说明 Postinstall 未执行，手动补跑一次：

```bash
node node_modules/electron/install.js   # 从本地缓存恢复，无需重新下载
```

启动开发模式：

```bash
pnpm dev
```

## 常用脚本

| 命令                 | 说明                                 |
| -------------------- | ------------------------------------ |
| `pnpm dev`           | 启动开发模式（支持 Vite HMR）        |
| `pnpm run build`     | 仅编译三端产物到 `out/`（不打包）    |
| `pnpm run preview`   | 用已编译产物启动应用（验证生产构建） |
| `pnpm run package`   | 打包为未压缩应用目录，输出到 `dist/` |
| `pnpm run make`      | 生成当前平台的安装包，输出到 `dist/` |
| `pnpm run release`   | 构建并发布（需配置 publish 凭据）    |
| `pnpm run typecheck` | TypeScript 类型检查                  |
| `pnpm run lint`      | oxlint + oxfmt 代码检查              |
| `pnpm run lint:fix`  | 自动修复代码风格                     |

## 项目结构

```
├── src/
│   ├── main.ts               # 主进程入口（构建到 out/main/main.cjs）
│   ├── preload.ts            # 预加载脚本（构建到 out/preload/preload.cjs）
│   ├── declarations.d.ts     # 全局类型声明
│   ├── renderer/             # 渲染进程（React + Tailwind）
│   ├── shared/               # 主/渲染共享类型与样式
│   └── ...
├── index.html                # 渲染页面模板（renderer 的 Vite root 为项目根）
├── electron.vite.config.ts   # 三端构建配置（main / preload / renderer）
├── electron-builder.yml      # 打包配置（目标平台、fuses、签名）
├── pnpm-workspace.yaml       # pnpm 配置（hoisted linker、构建脚本放行）
└── tsconfig.json
```

## 构建与打包

- 构建产物：`out/{main,preload,renderer}`（electron-vite 输出，不进版本库）
- 打包产物：`dist/`（electron-builder 输出，不进版本库）
- macOS 本地构建使用 ad-hoc 签名（`identity: '-'`）：fuses 会改写二进制，必须重签，否则 macOS 会直接终止应用；正式分发时替换为 Developer ID 或经 `CSC_LINK` 注入证书
- `dist/` 中的安装包需在对应平台（或 CI）上构建：macOS 主机默认只能产出 mac 目标，Windows/Linux 目标建议交由 CI

## 技术栈

- [Electron 44](https://www.electronjs.org/)
- [electron-vite 6](https://electron-vite.org/)（构建）
- [electron-builder 26](https://www.electron.build/)（打包）
- [Vite 8](https://vite.dev/)
- [TypeScript 6](https://www.typescriptlang.org/)
- [oxlint](https://oxc.rs/) / [oxfmt](https://oxc.rs/)
