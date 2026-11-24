/**
 * DomainRegistry：模块与域的唯一登记与生命周期入口。
 *
 * 模块 = 生命周期 + 依赖；Domain = 服务边界；Resource = 聚合根/读模型。
 * 注册表负责：registerModule / start / stop / activate / revoke，
 * 以及命令表、分发、订阅与投递。不解释 ref / locator。
 */

import type { CallResult, ChangeType, DomainUpdate } from '../contract.ts';
import { errorResult } from '../contract.ts';
import type { Address } from './address.ts';
import {
  coerceCommandInput,
  commandKey,
  validateCommandInput,
  type CommandContext,
  type CommandEntry,
  type CommandInput,
} from './command.ts';
import type { DomainModule } from './module.ts';
import { Domain, type Resource } from './resource.ts';

export interface Target {
  domain: Domain;
  resource: Resource;
}

const EMPTY_SUBSCRIBERS: ReadonlySet<string> = new Set();

export class DomainRegistry {
  private readonly modules = new Map<string, DomainModule>();
  private readonly domains = new Map<string, Domain>();
  private readonly commands = new Map<string, CommandEntry>();
  private readonly listeners = new Set<(update: DomainUpdate) => void>();
  private readonly started = new Set<string>();
  private readonly starting = new Set<string>();
  private owner: string | null = null;
  private running = false;

  /** 注册归属上下文：模块 attach 期间标明域、资源与命令的实现归属。 */
  withOwner<T>(owner: string, fn: () => T): T {
    const previous = this.owner;
    this.owner = owner;
    try {
      return fn();
    } finally {
      this.owner = previous;
    }
  }

  currentOwner(): string {
    return this.owner ?? 'system';
  }

  // ─── 模块生命周期 ──────────────────────────────────────────

  /** 登记模块：立即 attach 声明域；模块重复直接失败。 */
  registerModule(module: DomainModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`模块重复：${module.id}`);
    }
    try {
      this.withOwner(module.id, () => module.attach(this));
    } catch (error) {
      // attach 失败：回滚该模块已声明的域与命令。
      this.removeModule(module.id);
      throw error;
    }
    this.modules.set(module.id, module);
  }

  /** 按模块依赖拓扑启动。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const id of this.orderedModules()) await this.startModule(id);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** 反向停止；域与命令保留，可再次 start。 */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const id of this.orderedModules().reverse()) {
      await this.stopModule(id);
    }
  }

  /** 热激活：注册表已在运行时启动单个模块；未运行时等 start 统一拉起。 */
  async activate(moduleId: string): Promise<void> {
    if (!this.running) return;
    await this.startModule(moduleId);
  }

  async deactivate(moduleId: string): Promise<void> {
    await this.stopModule(moduleId);
  }

  /** 撤销模块归属：停止并移除其全部域与命令（插件热卸载）。 */
  async revoke(owner: string): Promise<void> {
    if (this.modules.has(owner)) {
      await this.stopModule(owner);
      this.removeModule(owner);
    }
    for (const [key, entry] of this.commands) {
      if (entry.owner === owner) this.commands.delete(key);
    }
  }

  private async startModule(id: string): Promise<void> {
    if (this.started.has(id)) return;
    if (this.starting.has(id)) throw new Error(`模块依赖成环：${id}`);

    const module = this.modules.get(id);
    if (!module) throw new Error(`模块不存在：${id}`);

    this.starting.add(id);
    try {
      for (const dependency of module.dependencies ?? []) {
        if (!this.modules.has(dependency)) {
          throw new Error(`模块 ${id} 依赖不存在的 ${dependency}`);
        }
        await this.startModule(dependency);
      }
      await module.start?.();
      this.started.add(id);
    } finally {
      this.starting.delete(id);
    }
  }

  private async stopModule(id: string): Promise<void> {
    if (!this.started.has(id)) return;
    this.started.delete(id);
    await this.modules.get(id)?.stop?.();
  }

  private removeModule(id: string): void {
    this.modules.delete(id);
    this.started.delete(id);
    for (const [name, domain] of this.domains) {
      if (domain.owner !== id) continue;
      domain.dispose();
      this.domains.delete(name);
      for (const [key, entry] of this.commands) {
        if (entry.address.domain === name) this.commands.delete(key);
      }
    }
    for (const [key, entry] of this.commands) {
      if (entry.owner === id) this.commands.delete(key);
    }
  }

  private orderedModules(): string[] {
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`模块依赖成环：${id}`);

      const module = this.modules.get(id);
      if (!module) throw new Error(`模块不存在：${id}`);

      visiting.add(id);
      for (const dependency of module.dependencies ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(id);
    };

    for (const id of this.modules.keys()) visit(id);
    return ordered;
  }

  // ─── 地址与命令表 ──────────────────────────────────────────

  define(name: string): Domain {
    let domain = this.domains.get(name);
    if (!domain) {
      domain = new Domain(name, this.currentOwner(), this);
      this.domains.set(name, domain);
    }
    return domain;
  }

  domainOf(name: string): Domain | null {
    return this.domains.get(name) ?? null;
  }

  /** 资源撤销时同步移除其命令，避免同地址重开时命令残留。 */
  removeResourceCommands(domain: string, resource: string): void {
    for (const [key, entry] of this.commands) {
      if (
        entry.address.domain === domain &&
        entry.address.resource === resource
      ) {
        this.commands.delete(key);
      }
    }
  }

  /** 命令表是分发唯一依据；重名直接失败，不静默覆盖。 */
  declareCommand(entry: CommandEntry): void {
    const key = commandKey(entry.address, entry.action);
    if (this.commands.has(key)) throw new Error(`命令重复：${key}`);
    this.commands.set(key, entry);
  }

  commandTable(): readonly CommandEntry[] {
    return [...this.commands.values()];
  }

  resolve(address: Address): Target | null {
    const domain = this.domains.get(address.domain);
    if (!domain) return null;
    const resource = domain.resourceOf(address.resource);
    return resource ? { domain, resource } : null;
  }

  /** 只读快照：供跨域读取初始状态，不建立订阅关系。 */
  snapshot(address: Address): unknown {
    return this.resolve(address)?.resource.snapshotValue() ?? null;
  }

  // ─── 订阅与投递 ────────────────────────────────────────────

  subscribe(viewId: string, address: Address): unknown {
    return this.resolve(address)?.resource.subscribe(viewId) ?? null;
  }

  unsubscribe(viewId: string, address: Address): void {
    this.resolve(address)?.resource.unsubscribe(viewId);
  }

  unsubscribeView(viewId: string): void {
    for (const domain of this.domains.values()) {
      for (const name of domain.names()) {
        domain.resourceOf(name)?.unsubscribe(viewId);
      }
    }
  }

  subscribersOf(address: Address): ReadonlySet<string> {
    return this.resolve(address)?.resource.subscribersOf() ?? EMPTY_SUBSCRIBERS;
  }

  onUpdate(listener: (update: DomainUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(update: DomainUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  // ─── 分发与变更 ────────────────────────────────────────────

  async dispatchCommand(
    address: Address,
    action: string,
    input: CommandInput,
    ctx: CommandContext,
  ): Promise<CallResult> {
    const entry = this.commands.get(commandKey(address, action));
    if (!entry) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: `未知命令：${address.domain}/${address.resource}/${action}`,
        },
      };
    }

    const coerced = coerceCommandInput(entry.decl, input);
    const invalid = validateCommandInput(entry.decl, coerced);
    if (invalid) {
      return { ok: false, error: { code: 'invalid', message: invalid } };
    }

    try {
      return { ok: true, data: await entry.run(coerced, ctx) };
    } catch (error) {
      return errorResult(error);
    }
  }

  /**
   * 域发变更：同一 ref 的订阅者收到同一条通知。
   *
   * `workspace/<ref>` 是工作区资源的 watch 地址；打开的资源才订阅它，
   * 因此没有资源条目时这次变更不会被任何人接收。
   */
  changed(ref: string, type: ChangeType): void {
    this.domains.get('workspace')?.resourceOf(ref)?.event('changed', {
      ref,
      type,
    });
  }
}
