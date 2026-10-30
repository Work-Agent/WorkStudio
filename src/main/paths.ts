/**
 * 主进程路径（ESM bundle：out/main/index.js）。
 *
 * electron-vite 产出 ESM 主进程（package.json type: module），因此没有
 * `__dirname`；统一经 import.meta.url 解析，避免各模块各自 hack。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataRoot } from './data-root';

export const mainDir = path.dirname(fileURLToPath(import.meta.url));

/** 渲染层页面（prod）。 */
export function rendererFile(file: string): string {
  return path.join(mainDir, '../renderer', file);
}

/** preload 产物路径（out/preload/<name>.cjs）。 */
export function preloadFile(name: string): string {
  return path.join(mainDir, `../preload/${name}.cjs`);
}

// ─── 数据根派生（architecture.md §2.6）─────────────────────
//
// 所有持久化目录由数据根派生，业务代码不自行拼接。

/** 根下任意路径。 */
export function rootPath(...segments: string[]): string {
  return path.join(getDataRoot(), ...segments);
}

/** 启动诊断日志目录。 */
export function logsDir(): string {
  return rootPath('logs');
}

export function bootLogFile(): string {
  return path.join(logsDir(), 'boot.log');
}

/** 视图插件根：安装、索引、解压沙盒、数据、目录缓存都在这里。 */
export function pluginsRoot(): string {
  return rootPath('plugins');
}

/** 插件自持数据根（<id>/settings.json）。 */
export function pluginDataRoot(): string {
  return path.join(pluginsRoot(), 'data');
}

export function pluginCatalogFile(): string {
  return path.join(pluginsRoot(), 'catalog.md');
}

export function pluginCatalogUrlFile(): string {
  return path.join(pluginsRoot(), 'catalog-url.txt');
}

/** 资源管道路由表（用户覆盖）。 */
export function uraBindingsFile(): string {
  return rootPath('ura-bindings.json');
}

/** 窗口恢复清单（上次打开的工作区集合）。 */
export function windowsFile(): string {
  return rootPath('windows.json');
}
