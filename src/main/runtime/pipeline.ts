/**
 * pipeline 组件：middleware 链、Domain 路由和 update 分发。
 */

import { DomainRegistry } from './domains.ts';
import type { Views } from './views.ts';
import type { DomainUpdate, IpcMessage, Middleware } from './shared.ts';

export class Pipeline {
  readonly views: Views;
  readonly domains: DomainRegistry;

  private readonly middlewares: Middleware[] = [];
  private running = false;

  constructor(domains: DomainRegistry, views: Views) {
    this.domains = domains;
    this.views = views;
    this.domains.onUpdate((update) => this.deliver(update));
  }

  use(middleware: Middleware): this {
    if (this.running) {
      throw new Error('cannot use middleware after pipeline activation');
    }
    this.middlewares.push(middleware);
    return this;
  }

  /** IPC 入站与 frame 出站共用的 middleware 链。 */
  dispatch(message: IpcMessage): Promise<unknown> {
    if (!this.running) return Promise.resolve(null);
    return this.run(0, message);
  }

  get isRunning(): boolean {
    return this.running;
  }

  activate(): void {
    if (this.running) return;
    this.running = true;
  }

  deactivate(): void {
    if (!this.running) return;
    this.running = false;
    this.clearViews();
  }

  private deliver(update: DomainUpdate): void {
    if (!this.running) return;

    for (const viewId of this.domains.subscribers(
      update.domain,
      update.resource,
    )) {
      void this.dispatch({ type: 'update', viewId, update }).catch(
        (error: unknown) => {
          console.error('[app] update dispatch failed', error);
        },
      );
    }
  }

  private clearViews(): void {
    this.domains.clearSubscribers();
  }

  private run(index: number, message: IpcMessage): Promise<unknown> {
    const middleware = this.middlewares[index];
    if (!middleware) return this.terminal(message);
    return Promise.resolve(
      middleware(message, () => this.run(index + 1, message)),
    );
  }

  private terminal(message: IpcMessage): Promise<unknown> {
    switch (message.type) {
      case 'subscribe':
        return Promise.resolve(
          this.domains.subscribe(
            message.viewId,
            message.domain,
            message.resource,
          ),
        );
      case 'unsubscribe':
        this.domains.unsubscribe(
          message.viewId,
          message.domain,
          message.resource,
        );
        return Promise.resolve();
      case 'command':
        return this.domains.dispatchCommand(message.call, async () => null);
      case 'notify':
        this.domains.dispatchNotify(
          message.origin,
          message.domain,
          message.resource,
          message.action,
          message.value,
        );
        return Promise.resolve();
      case 'update':
        this.views.send(message.viewId, message.update);
        return Promise.resolve();
    }
  }
}
