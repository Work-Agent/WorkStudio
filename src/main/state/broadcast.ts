/**
 * 事件广播（主进程 → 全部渲染窗口）。
 *
 * 通道：app:snapshot / app:event / ws:ui / ws:interaction:update（见 shared/channels.ts）。
 */
import { BrowserWindow } from 'electron';

export function broadcastToWindows(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}
