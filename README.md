# WorkStudio

基于 Electron + Vite + TypeScript 的桌面应用，使用 Electron Forge 构建与打包。

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
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm install
```

启动开发模式：

```bash
pnpm start
```

## 常用脚本

| 命令                 | 说明                          |
| -------------------- | ----------------------------- |
| `pnpm start`         | 启动开发模式（支持 Vite HMR） |
| `pnpm run package`   | 打包应用，输出到 `out/`       |
| `pnpm run make`      | 生成当前平台的安装包          |
| `pnpm run release`   | 发布应用                      |
| `pnpm run typecheck` | TypeScript 类型检查           |
| `pnpm run lint`      | oxlint + oxfmt 代码检查       |
| `pnpm run lint:fix`  | 自动修复代码风格              |

## 项目结构

```
├── src/
│   ├── main.ts           # 主进程入口
│   ├── preload.ts        # 预加载脚本
│   ├── renderer.ts       # 渲染进程入口
│   ├── index.css         # 渲染进程样式
│   └── declarations.d.ts # 全局类型声明
├── index.html            # 渲染页面模板
├── forge.config.mts      # Electron Forge 配置
├── vite.main.config.mts  # 主进程 Vite 配置
├── vite.preload.config.mts
├── vite.renderer.config.mts
├── pnpm-workspace.yaml   # pnpm 配置（允许 Electron 安装脚本）
└── tsconfig.json
```

## 技术栈

- [Electron 44](https://www.electronjs.org/)
- [Electron Forge 8](https://www.electronforge.io/)
- [Vite 8](https://vite.dev/)
- [TypeScript 6](https://www.typescriptlang.org/)
- [oxlint](https://oxc.rs/) / [oxfmt](https://oxc.rs/)
