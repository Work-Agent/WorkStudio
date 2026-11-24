/**
 * preload bridge 契约：页面唯一出口。
 *
 * 页面只发 domain / resource / action，不指定目标；
 * origin 判定、路由、日志与订阅归属都在主进程侧完成。
 */

import type { WorkStudioBridge } from '@workstudio/sdk';

export type { WorkStudioBridge };

/** preload 与主进程之间的通道；与业务地址无关。 */
export const BRIDGE_CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
} as const;
