/**
 * Router —— 组合根的绑定面（express / koa 的 use / get 语义）。
 *
 *   const router = new Router(host);
 *   const sessions = router.service('sessions', '/workspaces/:wsId/sessions');
 *   sessions.handle('/:sessionId/prompt', (call) => service.prompt(call.input));
 *   const current = sessions.state('/current');
 *   service.onChange(() => current.publish(service.current));
 *
 * 业务服务不认路径；路径绑定只发生在这一层。
 */

import type { EventHandle, StateHandle } from '../core/handles';
import { fill, join } from '../core/paths';
import type { Owner } from '../core/table';
import type { Origin, Params, RouteCall, ViewProvider } from '../core/types';
import type { Host } from '../framework/host';

export class Router {
  constructor(
    private readonly host: Host,
    private readonly base = '',
    private readonly owner: Owner = { type: 'app' },
  ) {}

  group(path: string, define: (child: Router) => void): void {
    define(new Router(this.host, join(this.base, path), this.owner));
  }

  /** 某个 service 的绑定作用域：owner 只用于归属与诊断。 */
  service(id: string, path = '/'): Router {
    return new Router(this.host, join(this.base, path), {
      type: 'service',
      id,
    });
  }

  handle<I, O>(
    path: string,
    handler: (call: RouteCall<I>) => O | Promise<O>,
  ): void {
    this.host.registerCommand(
      join(this.base, path),
      this.base,
      this.owner,
      (call) => handler(call as RouteCall<I>) as O | Promise<O>,
    );
  }

  state<T>(path: string): StateHandle<T> {
    return this.host.registerState<T>(
      join(this.base, path),
      this.base,
      this.owner,
    );
  }

  event<T>(
    path: string,
    options?: { view?: boolean; validate?: (value: unknown) => boolean },
  ): EventHandle<T> {
    return this.host.registerEvent<T>(
      join(this.base, path),
      this.base,
      this.owner,
      options?.view === true,
      options?.validate,
    );
  }

  /** 页面提供者：owner 取自绑定作用域。 */
  view(provider: ViewProvider): void {
    this.host.providers.register({
      ...provider,
      serviceId: this.owner.type === 'service' ? this.owner.id : 'app',
    });
  }

  async call<T>(path: string, input?: unknown): Promise<T> {
    const origin: Origin = {
      type: 'service',
      id: this.owner.type === 'service' ? this.owner.id : 'app',
      base: this.base,
    };
    const result = await this.host.call(origin, path, input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data as T;
  }

  on<T>(path: string, handler: (value: T) => void): () => void {
    const off = this.host.bus.subscribe((frame) => {
      if (frame.path === path) handler(frame.value as T);
    });
    const snapshot = this.host.bus.state<T>(path);
    if (snapshot) {
      queueMicrotask(() => {
        const current = this.host.bus.state<T>(path);
        if (current) handler(current.value);
      });
    }
    return off;
  }

  get<T>(path: string): T | null {
    return this.host.bus.read<T>(path);
  }

  at(path: string, params?: Params): string {
    return fill(join(this.base, path), params);
  }
}
