import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'fs';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { defaultAllowedOrigins, type Plugin } from 'vite';
import { buildPlugin } from '@workstudio/sdk/build';

/**
 * 内置插件（src/plugins：manifest + 静态页面）不参与打包，直接拷贝到 out/plugins。
 * PluginRegistry 生产环境扫 out/plugins（dev 扫 src/plugins），两处必须同形。
 */
function copyBuiltinPlugins(): Plugin {
  return {
    name: 'ws-copy-builtin-plugins',
    async writeBundle() {
      const from = resolve(__dirname, 'src/plugins');
      const to = resolve(__dirname, 'out/plugins');
      rmSync(to, { recursive: true, force: true });
      if (existsSync(from)) {
        cpSync(from, to, { recursive: true });
        for (const name of readdirSync(to)) {
          const root = resolve(to, name);
          if (!statSync(root).isDirectory()) continue;
          const sdkSource = resolve(__dirname, 'packages/sdk');
          const sdkTarget = resolve(root, 'node_modules/@workstudio/sdk');
          rmSync(sdkTarget, { recursive: true, force: true });
          cpSync(sdkSource, sdkTarget, { recursive: true });
          await buildPlugin(root);
        }
      }
      this.info(`copied + built builtin plugins → ${to}`);
    },
  };
}

/**
 * 主进程 bundle 需要 pi（ESM 依赖链）：
 * Rolldown 为 chunk 内的 CJS 依赖注入 `const __filename = import.meta.filename`
 * 垫片，而 pi 自己的 dist/config.js 又声明 `var __filename = fileURLToPath(...)`，
 * 同模块作用域下重复声明 → ESM 语法错误。这里在打包前把 pi 源码里的
 * __filename / __dirname 统一改名（其用法局限于文件内部）。
 */
function renamePiNodeGlobals(): Plugin {
  return {
    name: 'ws-rename-pi-node-globals',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('node_modules/@earendil-works/')) return null;
      if (!code.includes('__filename') && !code.includes('__dirname'))
        return null;
      return code
        .replace(/\b__filename\b/g, '__piFilename')
        .replace(/\b__dirname\b/g, '__piDirname');
    },
  };
}

/**
 * 首帧底色：页面 CSS 尚未加载时先按系统深浅铺底，避免深色模式白闪。
 * 与 `src/shared/appearance.ts` 的 THEME_GATE_STYLE 保持一致（同一份字符串）。
 */
function initialThemeBackground(): Plugin {
  const style =
    'html{background:#f4f4f5;color-scheme:light}@media (prefers-color-scheme:dark){html{background:#1a1c1d;color-scheme:dark}}';
  return {
    name: 'ws-initial-theme-background',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        if (html.includes('prefers-color-scheme:dark')) return html;
        return html.replace('<head>', `<head><style>${style}</style>`);
      },
    },
  };
}

/** work:// 系统页从 Vite 加载开发模块，并使用同一服务的热更新连接。 */
function workPageDevAssets(): Plugin {
  return {
    name: 'ws-work-page-dev-assets',
    apply: 'serve',
    config() {
      return {
        server: { cors: { origin: ['work://studio', defaultAllowedOrigins] } },
      };
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { path, server }) {
        const devUrl = server?.resolvedUrls?.local[0];
        if (!devUrl) return;
        return [
          {
            tag: 'base',
            attrs: { href: new URL(path, devUrl).href },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/**
 * electron-vite 构建配置（三段：main / preload / renderer）。
 *
 * - 主进程：ESM（package.json type: module），入口 src/main/entry.ts，产物 out/main/index.js
 *   —— pi SDK 是 ESM-only，静态 import 必须 ESM 载体。
 * - preload：多入口 CJS（.cjs）且单文件（共享常量内联）——sandbox: true 的
 *   WebContentsView 只接受 CJS 且无相对 require 能力。
 * - renderer：多页面（工作台 / 助手 / 浮层；指针捕获层用内联 data: 页，无独立入口）。
 */
export default defineConfig({
  main: {
    plugins: [renamePiNodeGlobals(), copyBuiltinPlugins()],
    build: {
      outDir: 'out/main',
      // 依赖全部打进主进程 bundle（pi + 其依赖）：打包时不再依赖 node_modules
      // 布局（pnpm hoisted 的嵌套依赖会被 electron-builder 漏拷）。
      externalizeDeps: false,
      lib: {
        entry: 'src/main/entry.ts',
        formats: ['es'],
      },
      rolldownOptions: {
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    plugins: [],
    build: {
      outDir: 'out/preload',
      rolldownOptions: {
        input: {
          'work-studio': resolve(__dirname, 'src/preload/work-studio.ts'),
          capture: resolve(__dirname, 'src/preload/capture.ts'),
        },
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      react(),
      tailwindcss(),
      workPageDevAssets(),
      initialThemeBackground(),
    ],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rolldownOptions: {
        input: {
          shell: resolve(__dirname, 'src/renderer/pages/shell/index.html'),
          assistant: resolve(
            __dirname,
            'src/renderer/pages/assistant/index.html',
          ),
          overlay: resolve(__dirname, 'src/renderer/pages/overlay/index.html'),
          settings: resolve(
            __dirname,
            'src/renderer/pages/settings/index.html',
          ),
          welcome: resolve(__dirname, 'src/renderer/pages/welcome/index.html'),
          capture: resolve(__dirname, 'src/renderer/pages/capture/index.html'),
          oauth: resolve(__dirname, 'src/renderer/pages/oauth/index.html'),
        },
      },
    },
  },
});
