/**
 * dispatcher 组件：sender → origin → Pipeline 的请求分发。
 *
 * Dispatcher 不接触 ipcMain；IPC attach/detach 由 App 管理。
 * 入站以 (domain, resource) 为订阅地址，以 (domain, resource, action) 为命令地址。
 */

import type { Pipeline } from './pipeline.ts';
import type { Views } from './views.ts';
import { errorResult } from './shared.ts';
import type { CallContext, CallResult } from './shared.ts';

export class Dispatcher {
  constructor(
    private readonly views: Views,
    private readonly pipeline: Pipeline,
  ) {}

  subscribe(
    senderId: number,
    domain: string,
    resource: string,
  ): Promise<unknown> {
    if (!this.pipeline.isRunning) return Promise.resolve(null);

    const origin = this.views.originOf(String(senderId));
    if (origin?.type !== 'view') return Promise.resolve(null);
    if (!this.views.get(origin.viewId)) return Promise.resolve(null);

    return this.pipeline.dispatch({
      type: 'subscribe',
      origin,
      viewId: origin.viewId,
      domain,
      resource,
    });
  }

  unsubscribe(senderId: number, domain: string, resource: string): void {
    if (!this.pipeline.isRunning) return;
    const origin = this.views.originOf(String(senderId));
    if (origin?.type !== 'view') return;
    void this.pipeline.dispatch({
      type: 'unsubscribe',
      origin,
      viewId: origin.viewId,
      domain,
      resource,
    });
  }

  async command(
    senderId: number,
    domain: string,
    resource: string,
    action: string,
    input: unknown,
  ): Promise<CallResult> {
    if (!this.pipeline.isRunning) {
      return this.invalidRequest('app is not running');
    }

    const origin = this.views.originOf(String(senderId));
    if (!origin) return this.invalidOrigin();

    const call: CallContext = { domain, resource, action, input, origin };
    try {
      const result = (await this.pipeline.dispatch({
        type: 'command',
        call,
      })) as CallResult | null;
      return (
        result ?? this.missing(`no command at ${domain}/${resource}/${action}`)
      );
    } catch (error) {
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
    if (!this.pipeline.isRunning) return;

    const origin = this.views.originOf(String(senderId));
    if (!origin) return;

    void this.pipeline
      .dispatch({ type: 'notify', origin, domain, resource, action, value })
      .catch((error: unknown) => {
        console.error('[app] notify failed', error);
      });
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
