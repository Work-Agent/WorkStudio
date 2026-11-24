/**
 * IPC channel：把 bridge 的 subscribe / command / notify 接到 Dispatcher。
 *
 * 这里只做通道注册与 sender 映射；origin 判定、路由与日志
 * 都在 Dispatcher 中完成。preload 只暴露 window.workStudio。
 */

import { ipcMain, webContents } from 'electron';
import type { DomainUpdate } from '../contract.ts';
import { BRIDGE_CHANNELS } from '../../shared/channels.ts';
import type { Dispatcher } from './dispatcher.ts';
import type { Origins } from './origins.ts';

export class IpcChannel {
  private attached = false;

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly origins: Origins,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;

    ipcMain.handle(
      BRIDGE_CHANNELS.subscribe,
      (event, domain: string, resource: string) => {
        const result = this.dispatcher.watch(
          String(event.sender.id),
          `${domain}/${resource}`,
        );
        return result.ok ? result.data : null;
      },
    );
    ipcMain.on(
      BRIDGE_CHANNELS.unsubscribe,
      (event, domain: string, resource: string) => {
        this.dispatcher.unwatch(
          String(event.sender.id),
          `${domain}/${resource}`,
        );
      },
    );
    ipcMain.handle(
      BRIDGE_CHANNELS.command,
      (
        event,
        domain: string,
        resource: string,
        action: string,
        input?: unknown,
      ) =>
        this.dispatcher.call(
          String(event.sender.id),
          `${domain}/${resource}`,
          action,
          input,
        ),
    );
    ipcMain.on(
      BRIDGE_CHANNELS.notify,
      (
        event,
        domain: string,
        resource: string,
        action: string,
        value?: unknown,
      ) => {
        this.dispatcher.send(
          String(event.sender.id),
          `${domain}/${resource}`,
          action,
          value,
        );
      },
    );
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    ipcMain.removeHandler(BRIDGE_CHANNELS.subscribe);
    ipcMain.removeAllListeners(BRIDGE_CHANNELS.unsubscribe);
    ipcMain.removeHandler(BRIDGE_CHANNELS.command);
    ipcMain.removeAllListeners(BRIDGE_CHANNELS.notify);
  }

  /** Dispatcher 的投递出口：viewId → 对应的 webContents。 */
  sendUpdate(viewId: string, update: DomainUpdate): void {
    const senderId = this.origins.senderOfView(viewId);
    if (!senderId) return;
    const target = webContents.fromId(Number(senderId));
    if (!target || target.isDestroyed()) return;
    target.send(BRIDGE_CHANNELS.update, update);
  }
}
