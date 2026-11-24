/**
 * 主进程路径（ESM bundle：out/main/index.js）。
 *
 * electron-vite 产出 ESM 主进程（package.json type: module），因此没有
 * `__dirname`；统一经 import.meta.url 解析，避免各模块各自 hack。
 *
 * 路径模型（磁盘路径与 `app://page` 的 URL 路径互转）在 path-codec.ts：
 * 那是纯模块，URL 构造与路由在 Node 环境加载时不会把 electron 拖进来。
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

// 路径编解码在 core（纯模块）：这里只按既有调用面转出，不重复实现。
export {
  createPathCodec,
  isWithin,
  pathCodec,
  pathRules,
} from './path-codec.ts';
export type { PathCodec, PathRules, PlatformPath } from './path-codec.ts';
