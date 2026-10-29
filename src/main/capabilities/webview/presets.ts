/**
 * 视图构造参数（architecture.md §5.1.3）。
 *
 * preload / partition / 页面 URL 的单一解析点；ViewHost 只消费本模块结果。
 */
import type { WebPreferences } from 'electron';
import { pathCodec, preloadFile, rendererFile } from '../../paths';

export type PreloadName =
  | 'workbench'
  | 'assistant'
  | 'extension'
  | 'browser'
  | 'overlay'
  | 'capture';

/** preload 产物路径。 */
export function preloadPath(name: PreloadName): string {
  return preloadFile(name);
}

/** 渲染层页面 URL（dev = Vite dev server；prod = file URL，路径由 pathCodec 统一处理）。 */
export function pageUrl(page: 'index' | 'assistant' | 'overlay'): string {
  const devServer = process.env['ELECTRON_RENDERER_URL'];
  const file = page === 'index' ? 'index.html' : `${page}.html`;
  if (devServer) return `${devServer.replace(/\/$/, '')}/${file}`;
  return pathCodec.fsToFileUrl(rendererFile(file));
}

/**
 * 插件页 / 设置页的 app:// 地址。
 *
 * 路径与编码由 pathCodec 统一处理（URL 侧分隔符恒 '/'、段内编码），
 * 页面里的相对资源（./assets/…）才能解析到同一插件目录。
 */
export function pageUrlFor(file: string): string {
  return `app://page${pathCodec.fsToUrlPath(file)}`;
}

/**
 * 指针捕获层内联页（无 UI、无脚本）：事件监听全在 capture-preload 里；
 * 透明全窗视图需要的是一个能收指针事件的 webContents，而非页面。
 */
export const CAPTURE_PAGE_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<html><body style="margin:0;padding:0;width:100%;height:100%;background:transparent"></body></html>',
  );

/** 主题底色（加载期防白闪）。 */
export function themeBackground(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#1a1c1d' : '#f4f4f5';
}

/** 视图 webPreferences（安全基线：三禁默认值显式写出）。 */
export function viewWebPreferences(
  preload: PreloadName,
  partition: string,
): WebPreferences {
  return {
    preload: preloadPath(preload),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    partition,
  };
}

export function partitionFor(
  scope: 'plugin' | 'browser' | 'assistant' | 'overlay',
  key = '',
): string {
  return `persist:workstudio:${scope}${key ? `:${key}` : ''}`;
}
