/**
 * 插件上下文：插件能拿到的全部。
 *
 * 没有绝对路径、没有进程对象、没有窗口；写与改只能通过命令，
 * 变更通过 changed 通知同一 ref 的所有订阅者。
 */

import type { ChangeType } from './bridge.ts';

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface PluginFs {
  read(ref: string): Promise<Uint8Array>;
  write(ref: string, bytes: Uint8Array): Promise<void>;
}

export interface PluginSettings {
  get<T>(): T;
  watch<T>(callback: (next: T) => void): () => void;
}

export interface PluginContext {
  fs: PluginFs;
  settings: PluginSettings;
  changed(ref: string, type: ChangeType): void;
  log: Log;
}
