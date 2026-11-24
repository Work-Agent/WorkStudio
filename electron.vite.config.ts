import { cpSync, existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { defaultAllowedOrigins, type Plugin } from 'vite';
import * as CHANNELS from './src/shared/channels';
import { parsePluginRegistry } from './src/shared/plugin-registry';

const PLUGIN_REGISTRY_ID = 'virtual:plugin-registry';
const PLUGIN_REGISTRY_FILE = resolve(__dirname, 'PLUGINS.md');

function readPluginRegistry() {
  return parsePluginRegistry(
    readFileSync(PLUGIN_REGISTRY_FILE, 'utf-8'),
    'PLUGINS.md',
  );
}

/**
 * 可安装插件清单（PLUGINS.md）是编译期资产：构建时解析成静态数组，
 * 主进程直接使用数据，运行期不读 Markdown；清单写错则构建失败。
 */
function pluginRegistry(): Plugin {
  const resolvedId = `\0${PLUGIN_REGISTRY_ID}`;
  return {
    name: 'ws-plugin-registry',
    enforce: 'pre',
    resolveId(id) {
      return id === PLUGIN_REGISTRY_ID ? resolvedId : null;
    },
    load(id) {
      if (id !== resolvedId) return null;
      this.addWatchFile(PLUGIN_REGISTRY_FILE);
      const entries = readPluginRegistry();
      this.info(`plugin registry: ${entries.length} entries`);
      return `export const PLUGIN_REGISTRY = ${JSON.stringify(entries)};\n`;
    },
  };
}
/**
 * 内置插件（src/plugins：manifest + 静态页面）不参与打包，直接拷贝到 out/plugins。
 * PluginRegistry 生产环境扫 out/plugins（dev 扫 src/plugins），两处必须同形。
 */
function copyBuiltinPlugins(): Plugin {
  return {
    name: 'ws-copy-builtin-plugins',
    writeBundle() {
      const from = resolve(__dirname, 'src/plugins');
      const to = resolve(__dirname, 'out/plugins');
      if (existsSync(from)) {
        rmSync(to, { recursive: true, force: true });
        cpSync(from, to, { recursive: true });
      }
      this.info(`copied builtin plugins → ${to}`);
    },
  };
}

/**
 * sandbox 化的 preload 只有一个受控的 require（不支持相对路径 chunk），
 * 因此 preload 构建必须单文件、零共享 chunk。通道常量是 preload 唯一的
 * 运行时共享 import —— 这里把它内联为字面量，保持 shared/channels.ts 单一事实源。
 */
function inlinePreloadChannels(): Plugin {
  const map = CHANNELS as unknown as Record<string, string>;
  return {
    name: 'ws-inline-preload-channels',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('/src/preload/') || !code.includes('/shared/channels'))
        return null;
      return code.replace(
        /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*shared\/channels(?:\.[cm]?[jt]s)?['"];?/g,
        (_match, names: string) =>
          names
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .map(
              (name) => `const ${name} = ${JSON.stringify(map[name] ?? '')};`,
            )
            .join('\n'),
      );
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
 * - 主进程：ESM（package.json type: module），产物 out/main/index.js
 *   —— pi SDK 是 ESM-only，静态 import 必须 ESM 载体。
 * - preload：多入口 CJS（.cjs）且单文件（共享常量内联）——sandbox: true 的
 *   WebContentsView 只接受 CJS 且无相对 require 能力。
 * - renderer：多页面（工作台 / 助手 / 浮层；指针捕获层用内联 data: 页，无独立入口）。
 */
export default defineConfig({
  main: {
    plugins: [pluginRegistry(), renamePiNodeGlobals(), copyBuiltinPlugins()],
    build: {
      outDir: 'out/main',
      // 依赖全部打进主进程 bundle（pi + 其依赖）：打包时不再依赖 node_modules
      // 布局（pnpm hoisted 的嵌套依赖会被 electron-builder 漏拷）。
      externalizeDeps: false,
      lib: {
        entry: 'src/main/index.ts',
        formats: ['es'],
      },
      rolldownOptions: {
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    plugins: [inlinePreloadChannels()],
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
    plugins: [react(), tailwindcss(), workPageDevAssets()],
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
        },
      },
    },
  },
});
