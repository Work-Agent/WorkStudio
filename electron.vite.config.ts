import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * electron-vite 构建配置（三段：main / preload / renderer）。
 *
 * - main、preload 输出 CJS（.cjs），与 package.json `main` = out/main/main.cjs 对应
 *   （package.json 无 `type: module`，Electron 按 CJS 加载）
 * - electron 与 node 内置模块由 electron-vite 预设外部化；dependencies 由
 *   `build.externalizeDeps` 自动外部化（该选项默认 true，无需插件）
 * - renderer 以项目根为 root（index.html 在根），产物 out/renderer；
 *   生产构建 base 自动为 './'，故 index.html 用相对路径加载
 */
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: 'src/main.ts',
        formats: ['cjs'],
      },
      // ssr 构建下 Vite 忽略 lib.fileName，只能从 output 指定入口文件名
      rolldownOptions: {
        output: { entryFileNames: 'main.cjs' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: 'src/preload.ts',
        formats: ['cjs'],
      },
      rolldownOptions: {
        output: { entryFileNames: 'preload.cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rolldownOptions: {
        input: 'index.html',
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
