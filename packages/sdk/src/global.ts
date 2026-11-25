/**
 * 页面全局类型：preload 注入 window.workStudio。
 *
 * 页面只写：
 *   import '@work-studio/sdk/global';
 *   await window.workStudio.command(...);
 *
 * 不再提供 createPage / page-core。
 */
import type { WorkStudioBridge } from './bridge.ts';

export type WorkStudioGlobal = typeof globalThis & {
  workStudio: WorkStudioBridge;
};

declare global {
  interface Window {
    workStudio: WorkStudioBridge;
  }
}
