/**
 * PluginManager：把插件贡献登记进 DomainRegistry 与 TransportRouter。
 *
 * 提供 DomainManager 的五项能力：register / revoke / resolve /
 * dispatchCommand / changed；撤销按 pluginId 一次完成。
 */

import type {
  PluginCommandInput,
  PluginContribution,
  PluginContext,
  PluginScope,
  PluginSettings,
} from '@workstudio/sdk';
import type { CallResult, ChangeType } from '../contract.ts';
import { createLog } from '../log.ts';
import type { TransportRouter } from '../transport/router.ts';
import type { Address } from '../registry/address.ts';
import { parseAddress } from '../registry/address.ts';
import type { CommandContext, CommandInput } from '../registry/command.ts';
import type { DomainRegistry, Target } from '../registry/registry.ts';
import type { Resource } from '../registry/resource.ts';
import type { ListService } from '../domains/workspace/lists.ts';
import { matchesClaim } from '../transport/resource.ts';
import type { PluginPackage } from './manifest.ts';
import type { PluginFiles } from './files.ts';
import type { SecretsService } from './secrets.ts';
import type { PluginStore } from './store.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PluginManagerOptions {
  store?: PluginStore;
  lists?: ListService;
  files?: PluginFiles;
  secrets?: SecretsService;
}

export interface PluginRegistration {
  package: PluginPackage;
  contribution: PluginContribution;
}

export class PluginManager {
  private readonly registrations = new Map<string, PluginRegistration>();
  private readonly scopes = new Map<string, PluginScope>();
  private readonly settings = new Map<string, Record<string, unknown>>();
  private readonly settingsListeners = new Map<
    string,
    Set<(next: unknown) => void>
  >();
  /** pluginId → setting key → 值变化回调。 */
  private readonly keyListeners = new Map<
    string,
    Map<string, Set<(value: unknown) => void>>
  >();
  private readonly eventsResources = new Map<string, Resource>();
  private readonly settingsResources = new Map<string, Resource>();

  constructor(
    private readonly registry: DomainRegistry,
    private readonly transport: TransportRouter,
    private readonly options: PluginManagerOptions = {},
  ) {}

  /** 激活期登记：把贡献注册成一个 Biz 域；生命周期归 DomainRegistry。 */
  register(pkg: PluginPackage, contribution: PluginContribution): void {
    const id = pkg.manifest.id;
    const domainName = pkg.manifest.id;
    // Biz 命令地址固定为 <domain>/<domain>/<action>：CLI 只有 domain 与 action，
    // 具体的 ref 放进入参，由域自己解释。
    const commandResource = domainName;

    if (!this.settings.has(id)) {
      this.settings.set(id, this.options.store?.readSettings(id) ?? {});
    }

    // 列表 id 全局唯一：冲突在登记任何东西之前拒绝，避免半成品。
    for (const list of contribution.lists ?? []) {
      if (this.options.lists?.registry.has(list.definition.id)) {
        throw new Error(`列表重复：${list.definition.id}`);
      }
    }

    try {
      this.registry.registerModule({
        id,
        attach: (registry) => {
          const domain = registry.define(domainName);
          if (!domain.resourceOf(commandResource)) {
            domain.resource(commandResource);
          }

          // 页面 SDK 的 page.settings.watch / set 使用 <domain>/settings。
          const settings = domain.resource('settings');
          settings.snapshot(() => this.settings.get(id) ?? {});
          settings.command('set', {
            summary: '更新插件设置',
            args: {},
            // 插件命令默认不进助手；设置写入只供插件页面调用。
            agentExposed: false,
            run: (input) => {
              const next = this.applySettings(id, input);
              settings.publish();
              return next;
            },
          });
          this.settingsResources.set(id, settings);

          if (contribution.events) {
            const events = domain.resource('events');
            events.snapshot(() => ({ ready: true }));
            this.eventsResources.set(id, events);
          }

          for (const [name, adapter] of Object.entries(
            contribution.resources,
          )) {
            if (!domain.resourceOf(name)) domain.resource(name);
            this.transport.register(
              domainName,
              adapter,
              pkg.manifest.claims ?? [],
            );
          }

          for (const [key, command] of Object.entries(contribution.commands)) {
            const dot = key.indexOf('.');
            const action = dot < 0 ? key : key.slice(dot + 1);
            registry.declareCommand({
              address: { domain: domainName, resource: commandResource },
              action,
              decl: { summary: command.summary, args: command.args ?? {} },
              owner: id,
              // 插件命令默认不向助手开放；文本读取走资源适配器。
              agentExposed: command.expose?.agent === true,
              run: (input, ctx) =>
                command.run(
                  input as PluginCommandInput,
                  this.contextOf(pkg, ctx),
                ),
            });
          }
        },
      });
    } catch (error) {
      // setup 失败：撤销已登记的数据适配器，域由 registry 自己回滚。
      this.transport.revoke(domainName);
      this.settingsResources.delete(id);
      this.eventsResources.delete(id);
      throw error;
    }

    for (const list of contribution.lists ?? []) {
      this.options.lists?.registry.register(list.definition, list.provider, id);
    }

    this.scopes.set(id, this.createScope(pkg));
    this.registrations.set(id, { package: pkg, contribution });
  }

  /** 域已在注册表中登记，这里只触发热激活。 */
  activate(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId);
    if (!registration) return Promise.resolve();
    return this.registry.activate(registration.package.manifest.id);
  }

  /** 激活完成后的收尾：运行时已就绪，重算该插件声明的列表。 */
  touchLists(pluginId: string): void {
    this.options.lists?.registry.touch(pluginId);
  }

  /** 激活期作用域：只在注册成功后存在，撤销时失效。 */
  scopeOf(pluginId: string): PluginScope | null {
    return this.scopes.get(pluginId) ?? null;
  }

  /** 热卸载：停止并撤销资源、命令与页面注册。 */
  async revoke(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId);
    await this.registry.revoke(pluginId);
    this.transport.revoke(registration?.package.manifest.id ?? pluginId);
    this.options.lists?.registry.revokeOwner(pluginId);
    this.registrations.delete(pluginId);
    this.scopes.delete(pluginId);
    this.settings.delete(pluginId);
    this.settingsListeners.delete(pluginId);
    this.keyListeners.delete(pluginId);
    this.settingsResources.delete(pluginId);
    this.eventsResources.delete(pluginId);
  }

  get(pluginId: string): PluginRegistration | undefined {
    return this.registrations.get(pluginId);
  }

  list(): PluginRegistration[] {
    return [...this.registrations.values()];
  }

  /** 已激活插件声明的技能目录；只返回真实存在的目录。 */
  skillPaths(): string[] {
    return this.skillSources().map((source) => source.path);
  }

  skillSources(): Array<{
    pluginId: string;
    pluginName: string;
    path: string;
  }> {
    const paths: Array<{
      pluginId: string;
      pluginName: string;
      path: string;
    }> = [];
    for (const { package: pkg } of this.registrations.values()) {
      const pluginId = pkg.manifest.id;
      const pluginName = pkg.manifest.label ?? pluginId;
      for (const dir of pkg.manifest.skills ?? []) {
        const path = join(pkg.root, dir);
        if (!existsSync(join(path, 'SKILL.md'))) continue;
        paths.push({ pluginId, pluginName, path });
      }
    }
    return paths;
  }

  /** 技能来源 → 插件身份；用于 skills 投影归因。 */
  skillOwner(source: string): { id: string; label: string } | null {
    const normalized = source.replace(/\\/g, '/');
    for (const source of this.skillSources()) {
      const root = source.path.replace(/\\/g, '/');
      if (normalized === root || normalized.startsWith(`${root}/`)) {
        return { id: source.pluginId, label: source.pluginName };
      }
    }
    return null;
  }

  /** 页面路由用的插件身份投影。 */
  plugin(pluginId: string): { id: string; label: string } | null {
    const pkg = this.registrations.get(pluginId)?.package;
    return pkg
      ? {
          id: pkg.manifest.id,
          label: pkg.manifest.label ?? pkg.manifest.id,
        }
      : null;
  }

  /** ref → 认领插件；冲突按 claims.priority 取最高。 */
  pluginOfRef(ref: string): { id: string; label: string } | null {
    let best: { pkg: PluginPackage; priority: number } | null = null;
    for (const { package: pkg } of this.registrations.values()) {
      for (const claim of pkg.manifest.claims ?? []) {
        if (!matchesClaim(ref, claim)) continue;
        const priority = claim.priority ?? 0;
        if (!best || priority > best.priority) {
          best = { pkg, priority };
        }
      }
    }
    return best
      ? {
          id: best.pkg.manifest.id,
          label: best.pkg.manifest.label ?? best.pkg.manifest.id,
        }
      : null;
  }

  resolve(address: string): Target | null {
    const parsed = parseAddress(address);
    return parsed ? this.registry.resolve(parsed) : null;
  }

  dispatchCommand(
    address: Address,
    action: string,
    input: CommandInput,
    ctx: CommandContext,
  ): Promise<CallResult> {
    return this.registry.dispatchCommand(address, action, input, ctx);
  }

  changed(ref: string, type: ChangeType): void {
    this.registry.changed(ref, type);
  }

  private applySettings(
    pluginId: string,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const previous = this.settings.get(pluginId) ?? {};
    const next = { ...previous, ...patch };
    delete next['ref'];
    this.settings.set(pluginId, next);
    this.options.store?.writeSettings(pluginId, next);
    for (const listener of this.settingsListeners.get(pluginId) ?? []) {
      listener(next);
    }
    for (const [key, listeners] of this.keyListeners.get(pluginId) ?? []) {
      if (Object.is(previous[key], next[key])) continue;
      for (const listener of listeners) listener(next[key]);
    }
    return next;
  }

  /** 单个设置键的变化：只在值真正改变时回调。 */
  private watchSetting<T>(
    pluginId: string,
    key: string,
    callback: (next: T) => void,
  ): () => void {
    let byKey = this.keyListeners.get(pluginId);
    if (!byKey) {
      byKey = new Map();
      this.keyListeners.set(pluginId, byKey);
    }
    let listeners = byKey.get(key);
    if (!listeners) {
      listeners = new Set();
      byKey.set(key, listeners);
    }
    const target = listeners;
    const listener = (next: unknown): void => callback(next as T);
    target.add(listener);
    return () => {
      target.delete(listener);
      if (target.size === 0) byKey.delete(key);
    };
  }

  settingsOf(pluginId: string): PluginSettings {
    if (!this.settings.has(pluginId)) {
      this.settings.set(
        pluginId,
        this.options.store?.readSettings(pluginId) ?? {},
      );
    }
    return {
      get: <T>() => (this.settings.get(pluginId) ?? {}) as T,
      watch: <T>(callback: (next: T) => void) => {
        let listeners = this.settingsListeners.get(pluginId);
        if (!listeners) {
          listeners = new Set();
          this.settingsListeners.set(pluginId, listeners);
        }
        const target = listeners;
        const listener = (next: unknown): void => callback(next as T);
        target.add(listener);
        return () => {
          target.delete(listener);
        };
      },
    };
  }

  /** 激活期作用域：跨命令、跨后台任务的全局上下文。 */
  private createScope(pkg: PluginPackage): PluginScope {
    const id = pkg.manifest.id;
    const log = createLog(`plugin:${id}`);
    return {
      pluginId: id,
      dataDir: this.options.store?.dataRootOf(id) ?? '',
      tempDir: this.options.store?.tempDirOf(id) ?? '',
      settings: {
        get: <T>(key: string, fallback: T): T => {
          const current = this.settings.get(id) ?? {};
          return key in current ? (current[key] as T) : fallback;
        },
        set: (patch) => {
          this.applySettings(id, patch);
          this.settingsResources.get(id)?.publish();
        },
        watch: <T>(key: string, callback: (next: T) => void) =>
          this.watchSetting(id, key, callback),
      },
      secrets: {
        availability: () =>
          this.options.secrets?.availability() ?? {
            available: false,
            reason: '密钥服务不可用',
          },
        get: async (key) => (await this.options.secrets?.get(id, key)) ?? null,
        set: async (key, value) => {
          if (!this.options.secrets) throw new Error('密钥服务不可用');
          await this.options.secrets.set(id, key, value);
        },
      },
      events: {
        emit: (name, data) => {
          const resource = this.eventsResources.get(id);
          if (!resource) {
            log.warn(`未声明事件通道，忽略事件：${name}`);
            return;
          }
          resource.event(name, data);
        },
      },
      files: {
        resolveInput: (token) => {
          if (!this.options.files) throw new Error('文件服务不可用');
          return this.options.files.resolveInput(id, token);
        },
        resolveSave: (token) => {
          if (!this.options.files) throw new Error('文件服务不可用');
          return this.options.files.resolveSave(id, token);
        },
      },
      log,
    };
  }

  private contextOf(pkg: PluginPackage, ctx: CommandContext): PluginContext {
    const id = pkg.manifest.id;
    return {
      fs: {
        read: (ref) => this.transport.readBytes(ref),
        write: (ref, bytes) => this.transport.writeBytes(ref, bytes),
      },
      settings: this.settingsOf(id),
      changed: (ref, type) => ctx.changed(ref, type),
      log: createLog(`plugin:${id}`),
    };
  }
}
