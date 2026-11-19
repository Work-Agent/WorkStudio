// ─── 插件宿主 ────────────────────────────────────────────────────────
//
// 扫描插件包 → 置入归属 → 执行 ./ura 注册入口 → 建立 surface → 页面 的映射。
// 内置插件静态装载（随应用构建），已安装插件动态 import 其 exports["./ura"]。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { uraRegistry, type UraRegistry } from '../ura/registry.ts';
import { isWithin } from '../../infrastructure/paths.ts';
import * as uraSdk from '../ura/sdk.ts';
import { listRegistry } from '../lists/registry.ts';
import type { PluginInfo } from '../../../shared/types.ts';
import {
  scanPluginPackages,
  type OfficeGenKind,
  type PluginPackage,
} from './packages.ts';

export interface BuiltinLoader {
  id: string;
  load: () => Promise<unknown>;
}

/**
 * 插件页面出口。
 *
 * page    = 文档查看器出口：由资源管道按 MIME 装载，必须带文档内容与页面会话。
 * settings = 配置面出口：由插件入口打开，无文档依赖。
 * 两种出口至少存在一个，且都只由各自的入口使用。
 */
export interface PluginPageEntry {
  id: string;
  label: string;
  icon?: string;
  version: string;
  page?: string;
  settings?: string;
  iconUrl?: string;
}

export interface PluginHostOptions {
  roots: string[];
  builtins: BuiltinLoader[];
  /** 插件数据根（settings.json 落盘位置）。 */
  dataRoot: string;
  registry?: UraRegistry;
  /** 热卸载回调：关闭该插件已打开的视图（视图层接入）。 */
  onDeactivate?: (pluginId: string) => void;
}

export class PluginHost {
  private readonly packages = new Map<string, PluginPackage>();
  private readonly diagnostics: string[] = [];
  private readonly loadErrors = new Map<string, string>();
  private readonly settings = new Map<string, Record<string, unknown>>();
  private importEpoch = 0;

  constructor(private readonly options: PluginHostOptions) {}

  async start(): Promise<void> {
    const registry = this.registry;
    // 外部插件包无法相对引用宿主源码：装载前把 SDK 注册面注入运行时。
    (globalThis as { __workstudioSdk?: typeof uraSdk }).__workstudioSdk =
      uraSdk;
    const scanned = await scanPluginPackages(this.options.roots);
    for (const pkg of scanned) {
      this.packages.set(pkg.id, pkg);
      // 两个出口都没有：插件能注册能力，但没有可打开的页面（不视为装载失败）。
      if (!pkg.page && !pkg.settings) {
        this.diagnostics.push(
          `插件没有声明页面：${pkg.id}（既无 page 也无 settings）`,
        );
      }
    }

    for (const builtin of this.options.builtins) {
      try {
        await registry.runAs(builtin.id, builtin.load);
      } catch (error) {
        this.diagnostics.push(
          `内置插件装载失败：${builtin.id} · ${messageOf(error)}`,
        );
      }
    }

    const builtinIds = new Set(this.options.builtins.map((b) => b.id));
    for (const pkg of scanned) {
      if (builtinIds.has(pkg.id) || !pkg.uraEntry) continue;
      await this.loadPackage(pkg);
    }
  }

  /** 装载单个插件包的注册入口（启动扫描与热安装共用）。 */
  private async loadPackage(pkg: PluginPackage): Promise<void> {
    if (!pkg.uraEntry) return;
    try {
      // ESM 按 URL 缓存模块；安装目录固定（installed/<id> 或原地目录），
      // 卸载重装 / 覆盖安装会命中旧缓存导致注册代码不再执行——
      // 用递增 query 保证每次激活都是全新求值。
      this.importEpoch += 1;
      const url = `${pathToFileURL(pkg.uraEntry).href}?v=${this.importEpoch}`;
      await this.registry.runAs(pkg.id, () => import(url));
      this.loadErrors.delete(pkg.id);
    } catch (error) {
      const message = messageOf(error);
      this.loadErrors.set(pkg.id, message);
      listRegistry.revokeOwner(pkg.id);
      this.registry.revokeOwner(pkg.id);
      this.diagnostics.push(`插件装载失败：${pkg.id} · ${message}`);
    }
  }

  /**
   * 热安装：扫描单个插件目录 → 装入运行时 → 执行注册入口。
   * 返回装入的插件包；目录不是有效插件包时返回 null。
   */
  async activate(root: string): Promise<PluginPackage | null> {
    // 与 start() 一致：外部包依赖运行时注入的 SDK 注册面（幂等）。
    (globalThis as { __workstudioSdk?: typeof uraSdk }).__workstudioSdk =
      uraSdk;
    const scanned = await scanPluginPackages([root]);
    const pkg = scanned.find((item) => item.root === root) ?? scanned[0];
    if (!pkg) return null;
    // 覆盖安装：撤下旧注册面并关闭旧版本页面，再装新版本。
    if (this.packages.has(pkg.id)) this.deactivate(pkg.id);
    this.packages.set(pkg.id, pkg);
    if (!pkg.page && !pkg.settings) {
      this.diagnostics.push(
        `插件没有声明页面：${pkg.id}（既无 page 也无 settings）`,
      );
    }
    await this.loadPackage(pkg);
    if (this.loadErrors.has(pkg.id))
      throw new Error(this.loadErrors.get(pkg.id));
    return pkg;
  }

  /** 热卸载：撤销注册面 + 移出运行时 + 关闭已打开的插件视图。 */
  deactivate(id: string): void {
    if (!this.packages.has(id)) return;
    this.revoke(id);
    this.options.onDeactivate?.(id);
  }

  /** 注册面撤销（ura 注册表 + 列表注册表）并移出包表。 */
  private revoke(id: string): void {
    this.registry.revokeOwner(id);
    listRegistry.revokeOwner(id);
    this.packages.delete(id);
  }

  get(id: string): PluginPackage | undefined {
    return this.packages.get(id);
  }

  /** 插件页面解析（views.open 与页面白名单共用）。 */
  getPage(id: string): PluginPageEntry | null {
    const pkg = this.packages.get(id);
    // 只有配置页（没有渲染页）的插件同样可打开：出口选择交给调用方。
    if (!pkg || this.loadErrors.has(id) || (!pkg.page && !pkg.settings))
      return null;
    return {
      id: pkg.id,
      label: pkg.label,
      ...(pkg.icon ? { icon: pkg.icon } : {}),
      version: pkg.version,
      ...(pkg.page ? { page: pkg.page } : {}),
      ...(pkg.settings ? { settings: pkg.settings } : {}),
      ...(pkg.iconUrl ? { iconUrl: pkg.iconUrl } : {}),
    };
  }

  list(): PluginPackage[] {
    return [...this.packages.values()];
  }

  /** surface（出口标识）+ 归属插件 → 渲染器页；raw 兜底用文本编辑器页。 */
  pageFor(surface: string, owner?: string): string | null {
    if (owner) return this.packages.get(owner)?.page ?? null;
    if (surface === 'raw')
      return this.packages.get('text-editor')?.page ?? null;
    return null;
  }

  /** 页面路径必须位于某个页面入口目录内（app://page 的准入）。 */
  containsPage(file: string): boolean {
    for (const pkg of this.packages.values()) {
      for (const page of [pkg.page, pkg.settings]) {
        if (!page) continue;
        if (isWithin(dirname(page), file)) return true;
      }
    }
    return false;
  }

  /** 插件清单投影（设置列表 / 插件列表）。 */
  pluginInfoList(): PluginInfo[] {
    const plugins = this.list().map((pkg) => ({
      id: pkg.id,
      name: pkg.label,
      version: pkg.version,
      loaded: !this.loadErrors.has(pkg.id),
      ...(this.loadErrors.has(pkg.id)
        ? { error: this.loadErrors.get(pkg.id) }
        : {}),

      ...(pkg.description ? { description: pkg.description } : {}),
      ...(pkg.author ? { author: pkg.author } : {}),
      ...(pkg.iconUrl ? { iconUrl: pkg.iconUrl } : {}),
      builtin: true,
      extensionCount: pkg.page ? 1 : 0,
      skillCount: pkg.skills.length,
      toolCount: 0,
      hasHome: false,
      hasConfig: !!pkg.settings,
    }));
    return plugins;
  }

  pluginNameOf(source: string): string {
    return this.packages.get(source)?.label ?? source;
  }

  /** 已装插件的技能目录（pi additionalSkillPaths 数据源；会话创建期生效）。 */
  skillPaths(): string[] {
    const paths: string[] = [];
    for (const pkg of this.packages.values()) {
      for (const skill of pkg.skills) paths.push(skill.dir);
    }
    return paths;
  }

  /** 某格式的生成脚本（按插件装入顺序取第一个声明；未声明返回 null，由调用方兜底）。 */
  genScriptOf(kind: OfficeGenKind): string | null {
    for (const pkg of this.packages.values()) {
      for (const skill of pkg.skills) {
        if (skill.gen?.kind === kind) return skill.gen.script;
      }
    }
    return null;
  }

  loadDiagnostics(): readonly string[] {
    return this.diagnostics;
  }

  // ─── 插件设置（settings.json，插件自持） ─────────────────

  async getSetting<T>(pluginId: string, key: string, fallback: T): Promise<T> {
    const all = await this.readSettings(pluginId);
    return (all[key] as T | undefined) ?? fallback;
  }

  async setSetting(
    pluginId: string,
    key: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    const all = await this.readSettings(pluginId);
    const next = { ...all, [key]: value };
    const file = this.settingsPath(pluginId);
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), 'utf-8');
    await rename(temp, file);
    this.settings.set(pluginId, next);
    return next;
  }

  private settingsPath(pluginId: string): string {
    return join(this.options.dataRoot, pluginId, 'settings.json');
  }

  private async readSettings(
    pluginId: string,
  ): Promise<Record<string, unknown>> {
    const cached = this.settings.get(pluginId);
    if (cached) return cached;
    const raw = await readFile(this.settingsPath(pluginId), 'utf-8').catch(
      () => null,
    );
    let parsed: Record<string, unknown> = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }
    this.settings.set(pluginId, parsed);
    return parsed;
  }

  private get registry(): UraRegistry {
    return this.options.registry ?? uraRegistry;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
