/**
 * IPC channel：把 bridge 的 subscribe / command / notify 接到 Dispatcher。
 *
 * 这里只做通道注册与 sender 映射；origin 判定、路由与日志
 * 都在 Dispatcher 中完成。preload 只暴露 window.workStudio。
 */

import { ipcMain, webContents } from 'electron';
import type { DomainUpdate } from '../contract.ts';
import { BRIDGE_CHANNELS } from '../../shared/channels.ts';
import type { PluginFiles } from '../plugin/files.ts';
import type { Dispatcher } from './dispatcher.ts';
import type { Origins } from './origins.ts';

export class IpcChannel {
  private attached = false;

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly origins: Origins,
    private readonly files: PluginFiles,
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
    ipcMain.handle(
      BRIDGE_CHANNELS.fileToken,
      (event, path: unknown, name?: unknown) => {
        // 只有宿主登记过的插件视图能导入文件；导入件留在插件临时区。
        const senderId = String(event.sender.id);
        const origin = this.origins.of(senderId);
        const pluginId = origin?.type === 'view' ? origin.pluginId : undefined;
        if (!pluginId) throw new Error('当前页面不能导入文件');
        if (typeof path !== 'string' || !path)
          throw new Error('文件路径不可用');
        return this.files.importFile(
          pluginId,
          path,
          typeof name === 'string' ? name : undefined,
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
    ipcMain.removeHandler(BRIDGE_CHANNELS.fileToken);
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
