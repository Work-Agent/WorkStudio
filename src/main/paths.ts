/**
 * 主进程路径（ESM bundle：out/main/index.js）。
 *
 * electron-vite 产出 ESM 主进程（package.json type: module），因此没有
 * `__dirname`；统一经 import.meta.url 解析，避免各模块各自 hack。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const mainDir = path.dirname(fileURLToPath(import.meta.url));

/** 渲染层页面（prod）。 */
export function rendererFile(file: string): string {
  return path.join(mainDir, '../renderer', file);
}

/** preload 产物路径（out/preload/<name>.cjs）。 */
export function preloadFile(name: string): string {
  return path.join(mainDir, `../preload/${name}.cjs`);
}
