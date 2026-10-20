// ─── 插件包（package.json 清单） ─────────────────────────────────────
//
// 插件就是 npm 包：清单字段与代码入口都在 package.json，没有单独的 manifest.json。
// 一个插件最多两个页面：page（渲染器）+ 可选 settings（设置页）。

import { readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export interface WorkStudioManifest {
  id?: string
  label?: string
  /** 图标语义名（壳层映射）。 */
  icon?: string
  /** 渲染器页。 */
  page?: string
  /** 设置页（可选）。 */
  settings?: string
  /** 随包携带的技能目录（相对插件根）。 */
  skills?: string[]
  /** 随包携带的 pi 扩展文件 / 目录（相对插件根）。 */
  piExtensions?: string[]
  webAccessible?: string[]
}

export interface PackageJson {
  name?: string
  version?: string
  description?: string
  author?: string | { name?: string }
  exports?: string | Record<string, unknown>
  workstudio?: WorkStudioManifest
}

export interface PluginPackage {
  id: string
  name: string
  /** 展示名。 */
  label: string
  /** 图标语义名。 */
  icon?: string
  version: string
  description?: string
  author?: string
  root: string
  /** 渲染器页（绝对路径）。 */
  page?: string
  /** 设置页（绝对路径）。 */
  settings?: string
  /** 注册入口（绝对路径）。 */
  uraEntry?: string
  /** pi 扩展入口（绝对路径）。 */
  piEntry?: string
  skills: string[]
  piExtensions: string[]
}

export async function scanPluginPackages(roots: string[]): Promise<PluginPackage[]> {
  const packages: PluginPackage[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
    if (!entries) continue
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packageRoot = join(root, entry.name)
      const manifest = await readPackage(packageRoot, entry.name)
      if (!manifest || seen.has(manifest.id)) continue
      seen.add(manifest.id)
      packages.push(manifest)
    }
  }
  return packages
}

async function readPackage(root: string, dirName: string): Promise<PluginPackage | null> {
  const raw = await readFile(join(root, 'package.json'), 'utf-8').catch(() => null)
  if (!raw) return null
  let pkg: PackageJson
  try {
    pkg = JSON.parse(raw) as PackageJson
  } catch {
    return null
  }
  const workstudio = pkg.workstudio
  if (!workstudio) return null

  const id = workstudio.id ?? pkg.name ?? dirName
  const page = await resolveFile(root, workstudio.page)
  const settingsPage = await resolveFile(root, workstudio.settings)
  return {
    id,
    name: pkg.name ?? id,
    label: workstudio.label ?? pkg.name ?? id,
    ...(workstudio.icon ? { icon: workstudio.icon } : {}),
    version: pkg.version ?? '0.0.0',
    description: pkg.description,
    author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name,
    root,
    page,
    settings: settingsPage,
    uraEntry: await resolveFile(root, exportPath(pkg.exports, './ura')),
    piEntry: await resolveFile(root, exportPath(pkg.exports, './pi')),
    skills: workstudio.skills ?? [],
    piExtensions: workstudio.piExtensions ?? [],
  }
}

function exportPath(exportsField: PackageJson['exports'], key: string): string | undefined {
  if (!exportsField) return undefined
  if (typeof exportsField === 'string') return exportsField
  const value = exportsField[key] ?? exportsField[key.replace('./', '')]
  if (typeof value === 'string') return value
  const nested = (value as Record<string, string> | undefined)?.default
  return typeof nested === 'string' ? nested : undefined
}

async function resolveFile(
  root: string,
  relative: string | undefined,
): Promise<string | undefined> {
  if (!relative) return undefined
  const absolute = isAbsolute(relative) ? relative : join(root, relative)
  const info = await stat(absolute).catch(() => null)
  return info?.isFile() ? absolute : undefined
}
