/**
 * appBridge IPC 传输：call / watch / emit / peek / frame + URA 监听兼容入口。
 *
 * 只做协议接线；来源解析、视图 hooks 与 URA watcher 由 ElectronCapability 注入。
 */
import { ipcMain } from 'electron';
import { CH_BUS, CH_URA, CH_URA_WATCH } from '../../../shared/channels';
import type { Origin } from '../../core/types';
import type { TransportBindings } from '../middleware';

const CH = {
  hello: 'appBridge:hello',
  call: 'appBridge:call',
  watch: 'appBridge:watch',
  emit: 'appBridge:emit',
  frame: 'appBridge:frame',
  peek: 'appBridge:peek',
} as const;

export interface TransportRuntime {
  originOf(externalId: string): Origin | null;
  onBus(senderId: string, message: unknown): void;
  watchUra(ref: string, onEvent: (event: unknown) => void): (() => void) | null;
}

export function bindTransport(
  bindings: TransportBindings,
  runtime: TransportRuntime,
): void {
  ipcMain.handle(CH.hello, () => true);

  ipcMain.on(CH_BUS, (event, message: unknown) => {
    runtime.onBus(String(event.sender.id), message);
  });

  ipcMain.handle(CH.call, (event, path: string, input?: unknown) => {
    const origin = runtime.originOf(String(event.sender.id));
    if (!origin) {
      return {
        ok: false,
        error: { code: 'denied', message: 'unknown sender' },
      };
    }
    return bindings.call(origin, path, input);
  });

  ipcMain.handle(CH.watch, (event, paths: string[]) => {
    const origin = runtime.originOf(String(event.sender.id));
    if (!origin || origin.type !== 'view') {
      return { granted: [], denied: paths };
    }
    return bindings.watch(origin.viewId, paths);
  });

  ipcMain.handle(CH.peek, (event, path: string) => {
    const origin = runtime.originOf(String(event.sender.id));
    if (!origin) return null;
    return bindings.peek(path);
  });

  ipcMain.on(CH.emit, (event, path: string, value: unknown) => {
    const origin = runtime.originOf(String(event.sender.id));
    if (origin) bindings.emit(origin, path, value);
  });

  ipcMain.handle(CH_URA_WATCH, (event, ref?: string) => {
    const sender = event.sender;
    const target = String(ref ?? '');
    const close = runtime.watchUra(target, (change) => {
      if (!sender.isDestroyed()) sender.send(CH_URA, change);
    });
    sender.once('destroyed', () => close?.());
    return { ref: target };
  });
}
