/**
 * 目标架构入口。
 *
 * 当前不接入 package.json；等 next 实现完整后一次性切换 out/main。
 */

import { app as electronApp } from 'electron';
import { bootstrapNext, type BootstrapOptions } from './bootstrap.ts';

export { NextApp, type NextAppOptions } from './app.ts';
export { bootstrapNext, type BootstrapOptions };

/** 直接启动；失败时退出进程，避免 Electron 悬挂。 */
export function runNext(options: BootstrapOptions = {}): void {
  void bootstrapNext(options)
    .then((result) => {
      if (!result) electronApp.quit();
    })
    .catch((error: unknown) => {
      console.error('[next] failed to start', error);
      electronApp.quit();
    });
}
