// ─── 插件宿主 ────────────────────────────────────────────────────────
//
// 扫描插件包 → 置入归属 → 执行 ./ura 注册入口 → 建立 surface → 页面 的映射。
// 内置插件静态装载（随应用构建），已安装插件动态 import 其 exports["./ura"]。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { uraRegistry, type UraRegistry } from '../ura/registry'
import type { PluginInfo } from '../../shared/types'
import { scanPluginPackages, type PluginPackage } from './packages'

export interface BuiltinLoader {
  id: string
  load: () => Promise<unknown>
}

export interface PluginHostOptions {
  roots: string[]
  builtins: BuiltinLoader[]
  /** 插件数据根（settings.json 落盘位置）。 */
  dataRoot: string
  registry?: UraRegistry
}

export class PluginHost {
  private readonly packages = new Map<string, PluginPackage>()
  private readonly diagnostics: string[] = []
  private readonly settings = new Map<string, Record<string, unknown>>()

  constructor(private readonly options: PluginHostOptions) {}

  async start(): Promise<void> {
    const registry = this.registry
    const scanned = await scanPluginPackages(this.options.roots)
    for (const pkg of scanned) this.packages.set(pkg.id, pkg)

    for (const builtin of this.options.builtins) {
      try {
        await registry.runAs(builtin.id, builtin.load)
      } catch (error) {
        this.diagnostics.push(`内置插件装载失败：${builtin.id} · ${messageOf(error)}`)
      }
    }

    const builtinIds = new Set(this.options.builtins.map((b) => b.id))
    for (const pkg of scanned) {
      if (builtinIds.has(pkg.id) || !pkg.uraEntry) continue
      try {
        const url = pathToFileURL(pkg.uraEntry).href
        await registry.runAs(pkg.id, () => import(url))
      } catch (error) {
        this.diagnostics.push(`插件装载失败：${pkg.id} · ${messageOf(error)}`)
      }
    }
  }

  get(id: string): PluginPackage | undefined {
    return this.packages.get(id)
  }

  list(): PluginPackage[] {
    return [...this.packages.values()]
  }

  /** surface（出口标识）+ 归属插件 → 渲染器页；raw 兜底用文本编辑器页。 */
  pageFor(surface: string, owner?: string): string | null {
    if (owner) return this.packages.get(owner)?.page ?? null
    if (surface === 'raw') return this.packages.get('text-editor')?.page ?? null
    return null
  }

  /** 页面路径必须位于某个页面入口目录内（app://page 的准入）。 */
  containsPage(file: string): boolean {
    for (const pkg of this.packages.values()) {
      for (const page of [pkg.page, pkg.settings]) {
        if (!page) continue
        const rel = relative(dirname(page), file)
        if (!rel.startsWith('..') && !isAbsolute(rel)) return true
      }
    }
    return false
  }

  settingsPageFor(id: string): string | null {
    return this.packages.get(id)?.settings ?? null
  }

  /** 插件清单投影（设置列表 / 插件列表）。 */
  pluginInfoList(): PluginInfo[] {
    return this.list().map((pkg) => ({
      id: pkg.id,
      name: pkg.label,
      version: pkg.version,
      ...(pkg.description ? { description: pkg.description } : {}),
      ...(pkg.author ? { author: pkg.author } : {}),
      builtin: true,
      extensionCount: pkg.page ? 1 : 0,
      skillCount: pkg.skills.length,
      toolCount: 0,
      hasHome: false,
      hasConfig: true,
    }))
  }

  /** 插件声明的技能目录（pi additionalSkillPaths）。 */
  getSkillPaths(): string[] {
    return this.list().flatMap((pkg) =>
      pkg.skills.map((spec) => join(pkg.root, spec)),
    )
  }

  /** 插件随包携带的 pi 扩展（additionalExtensionPaths）。 */
  getPiExtensionPaths(): string[] {
    return this.list().flatMap((pkg) =>
      pkg.piExtensions.map((rel) => join(pkg.root, rel)),
    )
  }

  pluginNameOf(source: string): string {
    return this.packages.get(source)?.label ?? source
  }

  loadDiagnostics(): readonly string[] {
    return this.diagnostics
  }

  // ─── 插件设置（settings.json，插件自持） ─────────────────

  async getSetting<T>(pluginId: string, key: string, fallback: T): Promise<T> {
    const all = await this.readSettings(pluginId)
    return (all[key] as T | undefined) ?? fallback
  }

  async setSetting(
    pluginId: string,
    key: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    const all = await this.readSettings(pluginId)
    const next = { ...all, [key]: value }
    const file = this.settingsPath(pluginId)
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${Date.now()}.tmp`
    await writeFile(temp, JSON.stringify(next, null, 2), 'utf-8')
    await rename(temp, file)
    this.settings.set(pluginId, next)
    return next
  }

  private settingsPath(pluginId: string): string {
    return join(this.options.dataRoot, pluginId, 'settings.json')
  }

  private async readSettings(
    pluginId: string,
  ): Promise<Record<string, unknown>> {
    const cached = this.settings.get(pluginId)
    if (cached) return cached
    const raw = await readFile(this.settingsPath(pluginId), 'utf-8').catch(
      () => null,
    )
    let parsed: Record<string, unknown> = {}
    if (raw) {
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>
      } catch {
        parsed = {}
      }
    }
    this.settings.set(pluginId, parsed)
    return parsed
  }

  private get registry(): UraRegistry {
    return this.options.registry ?? uraRegistry
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
