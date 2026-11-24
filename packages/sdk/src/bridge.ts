/**
 * 页面 bridge 契约。
 *
 * 外部插件页面通过 window.workStudio 使用它；插件引擎不直接依赖。
 * 页面只发 domain / resource / action，不指定目标。
 */

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

export interface WorkStudioBridge {
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
