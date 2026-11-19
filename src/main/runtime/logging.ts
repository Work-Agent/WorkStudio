/**
 * logging 组件：全局 IPC 日志中间件。
 *
 * 记录 subscribe / command / notify 入站与 update 出站的元信息，不记录 input。
 */

import type {
  CallErrorCode,
  CallResult,
  DomainUpdate,
  IpcMessage,
  Middleware,
  Origin,
} from './shared.ts';

export type IpcOutcome = 'ok' | 'error' | 'missing';

export interface IpcLog {
  type: IpcMessage['type'];
  direction: 'in' | 'out';
  origin?: string;
  domain?: string;
  resource?: string;
  action?: string;
  viewId?: string;
  updateType?: DomainUpdate['type'];
  durationMs: number;
  outcome: IpcOutcome;
  error?: { code: CallErrorCode; message: string };
}

export function requestLogger(
  write: (entry: IpcLog) => void = (entry) => console.log(entry),
): Middleware {
  return async (message, next) => {
    const started = Date.now();
    const base = describe(message);

    try {
      const result = await next();

      if (message.type !== 'command') {
        write({ ...base, durationMs: Date.now() - started, outcome: 'ok' });
        return result;
      }

      const callResult = result as CallResult | null;
      write({
        ...base,
        durationMs: Date.now() - started,
        outcome: callResult ? (callResult.ok ? 'ok' : 'error') : 'missing',
        ...(callResult && !callResult.ok ? { error: callResult.error } : {}),
      });
      return result;
    } catch (error) {
      write({
        ...base,
        durationMs: Date.now() - started,
        outcome: 'error',
        error: { code: 'failed', message: messageOf(error) },
      });
      throw error;
    }
  };
}

function describe(message: IpcMessage) {
  const origin = originOf(message);
  return {
    type: message.type,
    direction: message.type === 'update' ? ('out' as const) : ('in' as const),
    ...(origin ? { origin: describeOrigin(origin) } : {}),
    ...(message.type === 'subscribe' || message.type === 'unsubscribe'
      ? { domain: message.domain, resource: message.resource }
      : {}),
    ...(message.type === 'command'
      ? {
          domain: message.call.domain,
          resource: message.call.resource,
          action: message.call.action,
        }
      : {}),
    ...(message.type === 'notify'
      ? {
          domain: message.domain,
          resource: message.resource,
          action: message.action,
        }
      : {}),
    ...(message.type === 'update'
      ? {
          viewId: message.viewId,
          domain: message.update.domain,
          resource: message.update.resource,
          updateType: message.update.type,
        }
      : {}),
  };
}

function originOf(message: IpcMessage): Origin | null {
  if (message.type === 'command') return message.call.origin;
  if (
    message.type === 'subscribe' ||
    message.type === 'unsubscribe' ||
    message.type === 'notify'
  ) {
    return message.origin;
  }
  return null;
}

function describeOrigin(origin: Origin): string {
  switch (origin.type) {
    case 'view':
      return `view:${origin.viewType}:${origin.viewId}`;
    case 'service':
      return `service:${origin.id}`;
    case 'tool':
      return `tool:${origin.name}`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
