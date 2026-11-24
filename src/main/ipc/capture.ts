/**
 * 捕获层 IPC：独立于 bridge 的物理通道。
 *
 * 只处理 pointer move/up/cancel 与光标样式回写；origin 与布局计算仍在 shell。
 */

import { ipcMain, webContents } from 'electron';
import type { IpcMainEvent } from 'electron';
import {
  CAPTURE_CHANNEL,
  type CaptureCommand,
  type CaptureMessage,
} from '../../shared/capture.ts';

export type CaptureHandler = (
  senderId: string,
  message: CaptureMessage,
) => void;

export class CaptureChannel {
  private attached = false;
  private handler: CaptureHandler | null = null;

  attach(handler: CaptureHandler): void {
    if (this.attached) return;
    this.attached = true;
    this.handler = handler;
    ipcMain.on(CAPTURE_CHANNEL, this.onMessage);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.handler = null;
    ipcMain.removeListener(CAPTURE_CHANNEL, this.onMessage);
  }

  sendCursor(senderId: string, cursor: string): void {
    const target = webContents.fromId(Number(senderId));
    if (!target || target.isDestroyed()) return;
    target.send(CAPTURE_CHANNEL, {
      type: 'cursor',
      cursor,
    } satisfies CaptureCommand);
  }

  private readonly onMessage = (
    event: IpcMainEvent,
    message: CaptureMessage,
  ): void => {
    if (!message || typeof message !== 'object') return;
    this.handler?.(String(event.sender.id), message);
  };
}
