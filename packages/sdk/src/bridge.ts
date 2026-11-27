/**
 * 页面 bridge 契约。
 *
 * 外部插件页面通过 window.workStudio 使用它；插件引擎不直接依赖。
 * 页面只发 domain / resource / action，不指定目标。
 */

import type { ResourceAccess } from './access.ts';

export type CallErrorCode =
  | 'unknown'
  | 'denied'
  | 'invalid'
  | 'not_found'
  | 'failed';

export interface CallError {
  code: CallErrorCode;
  message: string;
}

export type CallResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: CallError };

export type ChangeType = 'content' | 'structure';

export type DomainUpdate =
  | {
      type: 'snapshot';
      domain: string;
      resource: string;
      data: unknown;
    }
  | {
      type: 'patch';
      domain: string;
      resource: string;
      data: Record<string, unknown>;
    }
  | {
      type: 'event';
      domain: string;
      resource: string;
      event: string;
      data: unknown;
    };

/** 页面选择本地文件后得到的导入凭证；页面永远拿不到绝对路径。 */
export interface FileToken {
  token: string;
  name: string;
  size: number;
}

/**
 * 页面与插件拿到的统一入口：取数面（ResourceAccess）+ 订阅 / 命令。
 * 取数面与助手工具是同一份实现，页面 ls 与助手 ls 看到的结果一致。
 */
export interface WorkStudioBridge extends ResourceAccess {
  /** 当前窗口绑定的工作区（窗口与工作区 1:1）；宿主未注入时为 null。 */
  readonly workspaceId: string | null;
  /** 把用户选择的 File 交给宿主托管，返回逻辑层可解析的 token。 */
  fileToken(file: File): Promise<FileToken>;
  subscribe(domain: string, resource: string): Promise<unknown>;
  unsubscribe(domain: string, resource: string): void;
  command<T = unknown>(
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<CallResult<T>>;
  notify(
    domain: string,
    resource: string,
    action: string,
    value?: unknown,
  ): void;
  onUpdate(listener: (update: DomainUpdate) => void): () => void;
}
