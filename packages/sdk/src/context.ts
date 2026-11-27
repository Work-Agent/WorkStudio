/**
 * 插件上下文：插件能拿到的全部。
 *
 * 没有绝对路径、没有进程对象、没有窗口；写与改只能通过命令，
 * 变更通过 changed 通知同一 ref 的所有订阅者。
 */

import type { ResourceAccess } from './access.ts';
import type { ChangeType } from './bridge.ts';
import type { PluginCredentials } from './credentials.ts';

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
  /** 取数与助手、页面同一份实现：插件不必自己扫目录。 */
  access: ResourceAccess;
  settings: PluginSettings;
  /** 供应商凭证：只写不读，范围由清单 `credentials` 声明。 */
  credentials: PluginCredentials;
  changed(ref: string, type: ChangeType): void;
  log: Log;
}
