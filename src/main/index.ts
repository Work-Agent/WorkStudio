/**
 * 主进程入口：单实例锁、能力/中间件组装与进程生命周期。
 */

import { app as electron, dialog, type App as ElectronApp } from 'electron';
import { App } from './app';
import { ElectronCapability } from './framework/electron-middleware';
import { ViewsCapability } from './framework/views-middleware';

/**
 * Bootstrap —— 进程生命周期与应用入口。
 *
 *   ① 单实例锁：抢不到直接退出，不碰数据根 / 日志 / 特权 scheme
 *   ② 组装：ElectronCapability + ViewsCapability + App
 *   ③ 进程事件 → App hook；退出拦截 → release → exit
 *   ④ ready → App.start()
 */
export class Bootstrap {
  constructor(private readonly electron: ElectronApp) {}

  run(): void {
    const { electron } = this;
    if (!electron.requestSingleInstanceLock()) {
      electron.quit();
      return;
    }

    const runtime = new ElectronCapability(electron);
    const core = App.claim(runtime);
    core.useCapability(runtime);
    core.useCapability(new ViewsCapability(runtime));
    this.wire(core);
  }

  private wire(core: App): void {
    const { electron } = this;

    electron.on('second-instance', () => core.activate());
    electron.on('activate', () => core.activate());
    electron.on('web-contents-created', (_event, wc) =>
      core.attachShortcuts(wc),
    );
    electron.on('window-all-closed', () => {
      // macOS 惯例：关窗常驻，由 activate 重开；其它平台直接退出。
      if (process.platform !== 'darwin') electron.quit();
    });

    let closing = false;
    electron.on('before-quit', (event) => {
      if (closing) return;
      closing = true;
      event.preventDefault();
      void core.release().finally(() => electron.exit(0));
    });

    void electron
      .whenReady()
      .then(() => core.start())
      .catch((error: unknown) => {
        core.reportFatal(error);
        // 启动失败不能只留日志：否则用户只看到图标跳一下就没了。
        dialog.showErrorBox(
          'WorkStudio 启动失败',
          `${error instanceof Error ? error.message : String(error)}\n\n详情见数据根 logs/boot.log。`,
        );
        electron.exit(1);
      });
  }
}

new Bootstrap(electron).run();
