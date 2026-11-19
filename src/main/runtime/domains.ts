/**
 * domains 组件：业务 domain → resource。
 *
 * 一个 Domain 是命名空间；Resource 才是状态 / 命令 / 订阅 / 推送的最小单位。
 * 订阅与命令都以 (domain, resource) 为地址，domain 不再是一个整体。
 */

import { errorResult } from './shared.ts';
import type {
  CallContext,
  CallResult,
  DomainEventHandler,
  DomainUpdate,
  Next,
  Origin,
  Patch,
} from './shared.ts';

type CommandHandler = (call: CallContext) => unknown;
type NotifyHandler = (call: CallContext) => void;

interface CommandEntry {
  handler: CommandHandler;
}

interface NotifyEntry {
  handler: NotifyHandler;
}

export class Resource {
  readonly domain: string;
  readonly name: string;

  private readonly registry: DomainRegistry;
  private readonly commands = new Map<string, CommandEntry>();
  private readonly notifies = new Map<string, NotifyEntry>();
  private readonly subscribers = new Set<string>();
  private snapshotProvider: (() => unknown) | null = null;

  constructor(domain: string, name: string, registry: DomainRegistry) {
    this.domain = domain;
    this.name = name;
    this.registry = registry;
  }

  /** 注册当前全量状态的读取函数；subscribe 和 publish 使用。 */
  snapshot(provider: () => unknown): void {
    this.snapshotProvider = provider;
  }

  /** 有回复的业务命令。 */
  command<I, O>(
    action: string,
    handler: (call: CallContext<I>) => O | Promise<O>,
  ): void {
    this.claim(action);
    this.commands.set(action, {
      handler: (call) => handler(call as CallContext<I>) as O | Promise<O>,
    });
  }

  /** 无回复的业务命令。 */
  notify(action: string, handler: NotifyHandler): void {
    this.claim(action);
    this.notifies.set(action, { handler });
  }

  /** 全量更新：读取 snapshot 后推给订阅者。 */
  publish(): void {
    this.registry.publishUpdate({
      type: 'snapshot',
      domain: this.domain,
      resource: this.name,
      data: this.snapshotProvider?.() ?? null,
    });
  }

  /** 部分更新：字段级 patch。 */
  patch(data: Patch): void {
    this.registry.publishUpdate({
      type: 'patch',
      domain: this.domain,
      resource: this.name,
      data,
    });
  }

  /** 瞬时事件 / SSE 流。 */
  event(name: string, data: unknown, seq?: number): void {
    this.registry.publishUpdate({
      type: 'event',
      domain: this.domain,
      resource: this.name,
      event: name,
      data,
      ...(seq === undefined ? {} : { seq }),
    });
  }

  /** 订阅本 resource；返回当前全量。 */
  subscribe(viewId: string): unknown {
    this.subscribers.add(viewId);
    return this.snapshotProvider?.() ?? null;
  }

  unsubscribeView(viewId: string): void {
    this.subscribers.delete(viewId);
  }

  clearSubscribers(): void {
    this.subscribers.clear();
  }

  subscribersOf(): ReadonlySet<string> {
    return this.subscribers;
  }

  /** 订阅 resource 间事件；event 可以是完整 key，也可以是本 resource 的短名。 */
  on(event: string, handler: DomainEventHandler): () => void {
    return this.registry.on(this.eventKey(event), handler);
  }

  /** 发布 resource 间事件；不会自动推给 view。 */
  emit(event: string, payload: unknown): void {
    this.registry.emit(this.eventKey(event), payload, this.sourceId());
  }

  async dispatchCommand(
    action: string,
    call: CallContext,
    next: Next<CallResult | null>,
  ): Promise<CallResult | null> {
    const entry = this.commands.get(action);
    if (!entry) return next();

    try {
      const data = await entry.handler(call);
      return { ok: true, data };
    } catch (error) {
      return errorResult(error);
    }
  }

  dispatchNotify(call: CallContext): boolean {
    const entry = this.notifies.get(call.action);
    if (!entry) return false;
    entry.handler(call);
    return true;
  }

  dispose(): void {
    this.subscribers.clear();
    this.commands.clear();
    this.notifies.clear();
    this.snapshotProvider = null;
  }

  private sourceId(): string {
    return `${this.domain}/${this.name}`;
  }

  private eventKey(event: string): string {
    return event.includes('.') ? event : `${this.sourceId()}.${event}`;
  }

  private claim(action: string): void {
    if (this.commands.has(action) || this.notifies.has(action)) {
      throw new Error(
        `duplicate action "${this.domain}/${this.name}.${action}"`,
      );
    }
  }
}

export class Domain {
  readonly name: string;

  private readonly registry: DomainRegistry;
  private readonly resources = new Map<string, Resource>();

  constructor(name: string, registry: DomainRegistry) {
    this.name = name;
    this.registry = registry;
  }

  /** 取 / 建一个 resource。 */
  resource(name: string): Resource {
    let resource = this.resources.get(name);
    if (!resource) {
      resource = new Resource(this.name, name, this.registry);
      this.resources.set(name, resource);
    }
    return resource;
  }

  resourceOf(name: string): Resource | null {
    return this.resources.get(name) ?? null;
  }

  remove(name: string): void {
    const resource = this.resources.get(name);
    if (!resource) return;
    resource.dispose();
    this.resources.delete(name);
  }

  resourceNames(): string[] {
    return [...this.resources.keys()];
  }

  async dispatchCommand(
    resource: string,
    action: string,
    call: CallContext,
    next: Next<CallResult | null>,
  ): Promise<CallResult | null> {
    const target = this.resources.get(resource);
    if (!target) return next();
    return target.dispatchCommand(action, call, next);
  }

  dispatchNotify(resource: string, call: CallContext): boolean {
    return this.resources.get(resource)?.dispatchNotify(call) ?? false;
  }
}

export class DomainRegistry {
  private readonly domains = new Map<string, Domain>();
  private readonly updateListeners = new Set<(update: DomainUpdate) => void>();
  private readonly eventSubscribers = new Map<
    string,
    Set<DomainEventHandler>
  >();

  onUpdate(listener: (update: DomainUpdate) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  define(name: string): Domain {
    let domain = this.domains.get(name);
    if (!domain) {
      domain = new Domain(name, this);
      this.domains.set(name, domain);
    }
    return domain;
  }

  resourceOf(domain: string, resource: string): Resource | null {
    return this.domains.get(domain)?.resourceOf(resource) ?? null;
  }

  subscribe(viewId: string, domain: string, resource: string): unknown {
    return this.resourceOf(domain, resource)?.subscribe(viewId) ?? null;
  }

  unsubscribe(viewId: string, domain: string, resource: string): void {
    this.resourceOf(domain, resource)?.unsubscribeView(viewId);
  }

  subscribers(domain: string, resource: string): ReadonlySet<string> {
    return (
      this.resourceOf(domain, resource)?.subscribersOf() ?? EMPTY_SUBSCRIBERS
    );
  }

  on(event: string, handler: DomainEventHandler): () => void {
    let handlers = this.eventSubscribers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventSubscribers.set(event, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  emit(event: string, payload: unknown, source = ''): void {
    const handlers = this.eventSubscribers.get(event);
    if (!handlers) return;

    for (const handler of Array.from(handlers)) {
      try {
        const result = handler(payload, source);
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            console.error(`[app] domain event "${event}" failed`, error);
          });
        }
      } catch (error) {
        console.error(`[app] domain event "${event}" failed`, error);
      }
    }
  }

  unsubscribeView(viewId: string): void {
    for (const domain of this.domains.values()) {
      for (const resource of domain.resourceNames()) {
        domain.resourceOf(resource)?.unsubscribeView(viewId);
      }
    }
  }

  clearSubscribers(): void {
    for (const domain of this.domains.values()) {
      for (const resource of domain.resourceNames()) {
        domain.resourceOf(resource)?.clearSubscribers();
      }
    }
  }

  async dispatchCommand(
    call: CallContext,
    next: Next<CallResult | null>,
  ): Promise<CallResult | null> {
    const domain = this.domains.get(call.domain);
    if (!domain) return next();
    return domain.dispatchCommand(call.resource, call.action, call, next);
  }

  dispatchNotify(
    origin: Origin,
    domainName: string,
    resource: string,
    action: string,
    value: unknown,
  ): boolean {
    const domain = this.domains.get(domainName);
    if (!domain) return false;
    const call: CallContext = {
      domain: domainName,
      resource,
      action,
      input: value,
      origin,
    };
    return domain.dispatchNotify(resource, call);
  }

  publishUpdate(update: DomainUpdate): void {
    for (const listener of Array.from(this.updateListeners)) {
      listener(update);
    }
  }

  remove(domain: string, resource: string): void {
    this.domains.get(domain)?.remove(resource);
  }
}

const EMPTY_SUBSCRIBERS: ReadonlySet<string> = new Set();
