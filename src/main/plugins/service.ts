// ─── 插件来源管理（npm / git / 本地路径） ────────────────────────────
//
// 与 pi 包同一套思路：来源声明落在用户数据目录，npm / git 安装到
// <userData>/plugins/node_modules，本地路径直接加载（不复制）。
// 安装 / 卸载只改声明与落盘，插件模块在下次启动时装载（注册表不支持热卸载）。

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../log'

const log = createLogger('plugin-sources')

export type PluginSourceType = 'npm' | 'git' | 'local'

export interface PluginSource {
  source: string
  type: PluginSourceType
  /** npm 包名（npm / git 安装后确定）。 */
  name?: string
  /** 本地路径（local）。 */
  path?: string
}

interface SourcesFile {
  sources: PluginSource[]
}

export interface PluginServiceOptions {
  /** 安装根（<userData>/plugins）。 */
  root: string
  /** 来源声明文件（<userData>/plugins.json）。 */
  file: string
  /** 相对路径解析基准（工作区）。 */
  cwd: () => string
}

export class PluginService {
  private sources: PluginSource[] = []

  constructor(private readonly options: PluginServiceOptions) {}

  async start(): Promise<void> {
    await mkdir(this.options.root, { recursive: true })
    const raw = await readFile(this.options.file, 'utf-8').catch(() => null)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as SourcesFile
      this.sources = Array.isArray(parsed.sources) ? parsed.sources : []
    } catch {
      log.warn('invalid plugin sources file', this.options.file)
    }
  }

  list(): PluginSource[] {
    return [...this.sources]
  }

  /** 本地来源优先，其次安装目录（node_modules），最后才是内置插件。 */
  roots(): string[] {
    const local = this.sources
      .filter((entry) => entry.type === 'local' && entry.path)
      .map((entry) => entry.path as string)
    return [...local, this.installRoot()]
  }

  async install(raw: string): Promise<PluginSource> {
    const source = raw.trim()
    if (!source) throw new Error('插件来源不能为空')
    const cwd = this.options.cwd()

    if (isLocalSource(source, cwd)) {
      const path = resolve(cwd, source.replace(/^~(?=\/)/, homedir()))
      const pkg = await readPackage(path)
      if (!pkg) throw new Error(`不是插件目录（缺少 package.json）：${path}`)
      if (!pkg.workstudio) throw new Error(`缺少 workstudio 清单：${path}`)
      return this.save({
        source,
        type: 'local',
        path,
        ...(pkg.name ? { name: pkg.name } : {}),
      })
    }

    const parsed = parseRemote(source)
    await this.ensureProject()
    const before = await this.dependencyNames()
    await this.runNpm(
      ['install', parsed.spec, '--prefix', this.options.root, '--no-audit', '--no-fund'],
      [parsed.spec],
    )
    const after = await this.dependencyNames()
    const added = after.filter((name) => !before.includes(name))
    const name =
      parsed.name ??
      (added.length === 1 ? added[0] : await this.findNewPlugin(before))
    if (!name)
      throw new Error(`无法识别安装的包：${source}（需包含 package.json）`)
    const pkg = await readPackage(join(this.installRoot(), name))
    if (!pkg?.workstudio) {
      await this.uninstallName(name)
      throw new Error(`不是 WorkStudio 插件（缺少 workstudio 清单）：${source}`)
    }
    return this.save({ source, type: parsed.type, name })
  }

  async remove(source: string): Promise<boolean> {
    const index = this.sources.findIndex((entry) => entry.source === source)
    if (index < 0) return false
    const entry = this.sources[index]
    if (entry.type !== 'local' && entry.name) {
      await this.runNpm(
        ['uninstall', entry.name, '--prefix', this.options.root, '--no-audit', '--no-fund'],
        [entry.source],
      )
    }
    this.sources.splice(index, 1)
    await this.persist()
    return true
  }

  // ─── 内部 ───────────────────────────────────────────────

  private installRoot(): string {
    return join(this.options.root, 'node_modules')
  }

  private async ensureProject(): Promise<void> {
    const pkgFile = join(this.options.root, 'package.json')
    if (existsSync(pkgFile)) return
    await writeFile(
      pkgFile,
      `${JSON.stringify({ name: 'workstudio-plugins', private: true }, null, 2)}\n`,
      'utf-8',
    )
  }

  private async dependencyNames(): Promise<string[]> {
    const raw = await readFile(
      join(this.options.root, 'package.json'),
      'utf-8',
    ).catch(() => null)
    if (!raw) return []
    try {
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>
      }
      return Object.keys(pkg.dependencies ?? {})
    } catch {
      return []
    }
  }

  private async findNewPlugin(before: string[]): Promise<string | null> {
    const root = this.installRoot()
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const candidates: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') continue
      if (entry.name.startsWith('@')) {
        const scoped = await readdir(join(root, entry.name), {
          withFileTypes: true,
        }).catch(() => [])
        for (const sub of scoped) {
          if (sub.isDirectory()) candidates.push(`${entry.name}/${sub.name}`)
        }
      } else if (!before.includes(entry.name)) {
        candidates.push(entry.name)
      }
    }
    for (const name of candidates) {
      const pkg = await readPackage(join(root, name))
      if (pkg?.workstudio) return name
    }
    return candidates[0] ?? null
  }

  private async save(entry: PluginSource): Promise<PluginSource> {
    const existing =
      entry.type === 'local'
        ? this.sources.findIndex(
            (item) => item.type === 'local' && item.path === entry.path,
          )
        : this.sources.findIndex(
            (item) =>
              item.type !== 'local' &&
              item.name &&
              item.name === entry.name,
          )
    if (existing >= 0) this.sources[existing] = entry
    else this.sources.push(entry)
    await this.persist()
    log.info('plugin source installed', entry.source)
    return entry
  }

  private async persist(): Promise<void> {
    const tmp = `${this.options.file}.tmp`
    await writeFile(
      tmp,
      `${JSON.stringify({ sources: this.sources }, null, 2)}\n`,
      'utf-8',
    )
    await rename(tmp, this.options.file)
  }

  private uninstallName(name: string): Promise<void> {
    return this.runNpm(
      ['uninstall', name, '--prefix', this.options.root, '--no-audit', '--no-fund'],
      [name],
    )
  }

  private runNpm(args: string[], source: string[]): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      execFile(
        'npm',
        args,
        { cwd: this.options.root, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (!error) return resolvePromise()
          const message = String(stderr || error.message)
          if (/\bENOENT\b/.test(message) && /npm/.test(message)) {
            reject(new Error('未找到 npm（请安装 Node.js 后重启应用）'))
            return
          }
          reject(new Error(`${source[0]}：${message.trim() || error.message}`))
        },
      )
    })
  }
}

// ─── 来源解析 ─────────────────────────────────────────────

function isLocalSource(source: string, cwd: string): boolean {
  if (source.startsWith('.') || source.startsWith('~') || isAbsolute(source))
    return true
  // 不带前缀但确实存在的本地目录（如 OfficePlugin）按本地处理。
  return existsSync(resolve(cwd, source))
}

function parseRemote(source: string): {
  type: 'npm' | 'git'
  spec: string
  name?: string
} {
  if (source.startsWith('npm:')) {
    const spec = source.slice(4)
    return { type: 'npm', spec, name: packageNameOf(spec) }
  }
  if (source.startsWith('git:')) {
    return { type: 'git', spec: gitSpec(source.slice(4)) }
  }
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(source)) {
    return { type: 'git', spec: gitSpec(source) }
  }
  throw new Error(
    `无法识别的来源：${source}（npm:<包名> / git:<仓库> / 本地路径）`,
  )
}

/** git 来源 → npm 可安装规格（github.com/u/r@v1 → git+https://…#v1）。 */
function gitSpec(input: string): string {
  let url = input
  let ref = ''
  const at = url.lastIndexOf('@')
  if (at > 0 && !url.slice(at).includes('/')) {
    ref = `#${url.slice(at + 1)}`
    url = url.slice(0, at)
  }
  const hash = url.indexOf('#')
  if (hash >= 0) {
    ref = url.slice(hash)
    url = url.slice(0, hash)
  }
  if (url.startsWith('git@')) {
    url = `ssh://${url.replace(':', '/')}`
  }
  if (!url.startsWith('ssh://')) {
    if (!/^https?:\/\//.test(url)) url = `https://${url}`
    if (url.endsWith('.git')) url = url.slice(0, -4)
    url = `${url}.git`
  }
  return `git+${url}${ref}`
}

function packageNameOf(spec: string): string {
  const cleaned = spec.replace(/@[^/]+$/, '')
  return spec.startsWith('@') ? cleaned : cleaned.split('/')[0]
}

async function readPackage(
  root: string,
): Promise<{ name?: string; workstudio?: unknown } | null> {
  const raw = await readFile(join(root, 'package.json'), 'utf-8').catch(
    () => null,
  )
  if (!raw) return null
  try {
    return JSON.parse(raw) as { name?: string; workstudio?: unknown }
  } catch {
    return null
  }
}
