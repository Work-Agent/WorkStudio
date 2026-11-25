/**
 * Domain 与 Resource。
 *
 * Domain 是服务边界；Resource 是域内可订阅、可寻址的聚合根/读模型。
 * Resource 只持有快照、订阅者与命令入口；业务状态由模块的聚合根持有。
 */

import { formatAddress } from './address.ts';
import type { CommandSpec } from './command.ts';
import type { DomainRegistry } from './registry.ts';

export type SnapshotProvider = () => unknown;

export class Resource {
  readonly domain: string;
  readonly name: string;
  readonly owner: string;

  private readonly registry: DomainRegistry;
  private readonly subscribers = new Set<string>();
  private snapshotProvider: SnapshotProvider | null = null;

  constructor(
    registry: DomainRegistry,
    domain: string,
    name: string,
    owner: string,
  ) {
    this.registry = registry;
    this.domain = domain;
    this.name = name;
    this.owner = owner;
  }

  address(): string {
    return formatAddress({ domain: this.domain, resource: this.name });
  }

  /** 当前全量投影；subscribe 与 publish 共用。 */
  snapshot(provider: SnapshotProvider): void {
    this.snapshotProvider = provider;
  }

  /** 只读当前快照，不绑定订阅者；供跨域读取初始状态。 */
  snapshotValue(): unknown {
    return this.snapshotProvider?.() ?? null;
  }

  command(action: string, spec: CommandSpec): void {
    this.registry.declareCommand({
      address: { domain: this.domain, resource: this.name },
      action,
      decl: { summary: spec.summary, args: spec.args ?? {} },
      owner: this.owner,
      // 可选字段原样透传；未声明时保持「缺省暴露」，不改变既有命令行为。
      agentExposed: spec.agentExposed,
      run: spec.run,
    });
  }

  publish(): void {
    this.registry.publish({
      type: 'snapshot',
      domain: this.domain,
      resource: this.name,
      data: this.snapshotValue(),
    });
  }

  patch(data: Record<string, unknown>): void {
    this.registry.publish({
      type: 'patch',
      domain: this.domain,
      resource: this.name,
      data,
    });
  }

  event(name: string, data: unknown): void {
    this.registry.publish({
      type: 'event',
      domain: this.domain,
      resource: this.name,
      event: name,
      data,
    });
  }

  subscribe(viewId: string): unknown {
    this.subscribers.add(viewId);
    return this.snapshotValue();
  }

  unsubscribe(viewId: string): void {
    this.subscribers.delete(viewId);
  }

  clearSubscribers(): void {
    this.subscribers.clear();
  }

  subscribersOf(): ReadonlySet<string> {
    return this.subscribers;
  }

  dispose(): void {
    this.subscribers.clear();
    this.snapshotProvider = null;
  }
}

export class Domain {
  readonly name: string;
  readonly owner: string;

  private readonly registry: DomainRegistry;
  private readonly resources = new Map<string, Resource>();

  constructor(name: string, owner: string, registry: DomainRegistry) {
    this.name = name;
    this.owner = owner;
    this.registry = registry;
  }

  /** 取 / 建一个 resource；同一地址只能归属一个实现。 */
  resource(name: string): Resource {
    const existing = this.resources.get(name);
    if (existing) {
      if (existing.owner !== this.owner) {
        throw new Error(
          `资源重复认领：${this.name}/${name}（${existing.owner} 与 ${this.owner}）`,
        );
      }
      return existing;
    }
    const resource = new Resource(this.registry, this.name, name, this.owner);
    this.resources.set(name, resource);
    return resource;
  }

  resourceOf(name: string): Resource | null {
    return this.resources.get(name) ?? null;
  }

  names(): string[] {
    return [...this.resources.keys()];
  }

  remove(name: string): void {
    const resource = this.resources.get(name);
    if (!resource) return;
    resource.dispose();
    this.registry.removeResourceCommands(this.name, name);
    this.resources.delete(name);
  }

  dispose(): void {
    for (const name of this.resources.keys()) this.remove(name);
    this.resources.clear();
  }
}
