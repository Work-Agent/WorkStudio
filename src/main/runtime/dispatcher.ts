/**
 * dispatcher 组件：sender → origin → DomainRegistry 的请求分发。
 *
 * Dispatcher 不接触 ipcMain；IPC attach/detach 由 App 管理。
 * 入站以 (domain, resource) 为订阅地址，以 (domain, resource, action) 为命令地址。
 *
 * IPC 日志也在这里完成：默认关闭，AppOptions.ipcLog 或 WA_IPC_LOG=1 打开。
 * 只记录地址、来源、耗时和结果，不记录 input。
 */

import type { Views } from '../domains/shell/views.ts';
import type { DomainRegistry } from './domains.ts';
import { errorResult } from './shared.ts';
import type {
  CallContext,
  CallResult,
  DomainUpdate,
  Origin,
} from './shared.ts';

export interface DispatcherOptions {
  log?: boolean;
}

type IpcType = 'subscribe' | 'unsubscribe' | 'command' | 'notify';
type IpcOutcome = 'ok' | 'error' | 'missing';

interface IpcLogEntry {
  type: IpcType;
  origin: string;
  domain?: string;
  resource?: string;
  action?: string;
  durationMs: number;
  outcome: IpcOutcome;
  error?: string;
}

export class Dispatcher {
  private readonly log: boolean;

  private readonly views: Views;
  private readonly domains: DomainRegistry;
  private active = false;

  constructor(
    views: Views,
    domains: DomainRegistry,
    options: DispatcherOptions = {},
  ) {
    this.views = views;
    this.domains = domains;
    this.log = options.log ?? false;
    domains.onUpdate((update) => this.deliver(update));
  }

  get isActive(): boolean {
    return this.active;
  }

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.domains.clearSubscribers();
  }

  subscribe(
    senderId: number,
    domain: string,
    resource: string,
  ): Promise<unknown> {
    const started = Date.now();
    const origin = this.views.originOf(String(senderId));
    if (!this.active) {
      this.write({ type: 'subscribe', domain, resource }, started, 'missing');
      return Promise.resolve(null);
    }
    if (origin?.type !== 'view' || !this.views.get(origin.viewId)) {
      this.write({ type: 'subscribe', domain, resource }, started, 'missing');
      return Promise.resolve(null);
    }

    try {
      const result = this.domains.subscribe(origin.viewId, domain, resource);
      this.write(
        { type: 'subscribe', origin, domain, resource },
        started,
        'ok',
      );
      return Promise.resolve(result);
    } catch (error) {
      this.write(
        { type: 'subscribe', origin, domain, resource },
        started,
        'error',
        messageOf(error),
      );
      return Promise.resolve(null);
    }
  }

  unsubscribe(senderId: number, domain: string, resource: string): void {
    const started = Date.now();
    const origin = this.views.originOf(String(senderId));
    if (!this.active || origin?.type !== 'view') {
      this.write({ type: 'unsubscribe', domain, resource }, started, 'missing');
      return;
    }
    this.domains.unsubscribe(origin.viewId, domain, resource);
    this.write(
      { type: 'unsubscribe', origin, domain, resource },
      started,
      'ok',
    );
  }

  async command(
    senderId: number,
    domain: string,
    resource: string,
    action: string,
    input: unknown,
  ): Promise<CallResult> {
    const started = Date.now();
    const origin = this.views.originOf(String(senderId));
    if (!this.active) {
      this.write(
        { type: 'command', domain, resource, action },
        started,
        'missing',
        'app is not running',
      );
      return this.invalidRequest('app is not running');
    }
    if (!origin) {
      this.write(
        { type: 'command', domain, resource, action },
        started,
        'missing',
        'unknown view origin',
      );
      return this.invalidOrigin();
    }

    const call: CallContext = { domain, resource, action, input, origin };
    try {
      const result = await this.domains.dispatchCommand(call, async () => null);
      const resolved =
        result ?? this.missing(`no command at ${domain}/${resource}/${action}`);
      this.write(
        { type: 'command', origin, domain, resource, action },
        started,
        resolved.ok ? 'ok' : 'error',
        resolved.ok ? undefined : resolved.error.message,
      );
      return resolved;
    } catch (error) {
      this.write(
        { type: 'command', origin, domain, resource, action },
        started,
        'error',
        messageOf(error),
      );
      return errorResult(error);
    }
  }

  notify(
    senderId: number,
    domain: string,
    resource: string,
    action: string,
    value: unknown,
  ): void {
    const started = Date.now();
    const origin = this.views.originOf(String(senderId));
    if (!this.active || !origin) {
      this.write(
        { type: 'notify', domain, resource, action },
        started,
        'missing',
      );
      return;
    }

    try {
      this.domains.dispatchNotify(origin, domain, resource, action, value);
      this.write(
        { type: 'notify', origin, domain, resource, action },
        started,
        'ok',
      );
    } catch (error) {
      this.write(
        { type: 'notify', origin, domain, resource, action },
        started,
        'error',
        messageOf(error),
      );
      console.error('[app] notify failed', error);
    }
  }

  private deliver(update: DomainUpdate): void {
    if (!this.active) return;
    for (const viewId of this.domains.subscribers(
      update.domain,
      update.resource,
    )) {
      this.views.send(viewId, update);
    }
  }

  private write(
    base: Omit<IpcLogEntry, 'origin' | 'durationMs' | 'outcome'> & {
      origin?: Origin;
    },
    started: number,
    outcome: IpcOutcome,
    error?: string,
  ): void {
    if (!this.log) return;
    const entry: IpcLogEntry = {
      type: base.type,
      origin: base.origin ? originLabel(base.origin) : 'unknown',
      ...(base.domain ? { domain: base.domain } : {}),
      ...(base.resource ? { resource: base.resource } : {}),
      ...(base.action ? { action: base.action } : {}),
      durationMs: Date.now() - started,
      outcome,
      ...(error ? { error } : {}),
    };
    console.log('[ipc]', entry);
  }

  private invalidOrigin(): CallResult<never> {
    return this.invalidRequest('unknown view origin');
  }

  private missing(message: string): CallResult<never> {
    return { ok: false, error: { code: 'unknown', message } };
  }

  private invalidRequest(message: string): CallResult<never> {
    return {
      ok: false,
      error: { code: 'invalid', message },
    };
  }
}

function originLabel(origin: Origin): string {
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
