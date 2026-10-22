// ─── 插件社区目录（Markdown 固定格式） ───────────────────────────────
//
// 一份 Markdown = 一份目录：二级/三级标题为分类，表格为条目。
// 固定表头：id / name / description / source / icon / tags。
// 拉取成功写缓存；失败回退缓存并标记 stale。

import { readFile, rename, writeFile } from 'node:fs/promises'
import { createLogger } from '../log'

const log = createLogger('plugin-catalog')

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/SimbaLink/WorkStudio-Plugins/main/PLUGINS.md'

const REQUIRED = ['id', 'name', 'source'] as const
const SOURCE_RE = /^(npm:|git:|https?:\/\/)/i
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i

export interface CatalogEntry {
  id: string
  name: string
  description: string
  source: string
  icon?: string
  tags: string[]
  category: string
}

export interface CatalogResult {
  entries: CatalogEntry[]
  url: string
  fetchedAt: number | null
  stale: boolean
  error?: string
}

export interface CatalogOptions {
  cacheFile: string
  urlFile: string
  defaultUrl?: string
}

export class PluginCatalogService {
  private url: string

  constructor(private readonly options: CatalogOptions) {
    this.url = options.defaultUrl ?? DEFAULT_CATALOG_URL
  }

  async start(): Promise<void> {
    const stored = await readFile(this.options.urlFile, 'utf-8').catch(
      () => null,
    )
    if (stored?.trim()) this.url = stored.trim()
  }

  currentUrl(): string {
    return this.url
  }

  /** 拉取目录；url 省略时用上次地址。失败回退缓存。 */
  async load(url?: string): Promise<CatalogResult> {
    const target = url?.trim() || this.url
    if (url?.trim()) {
      this.url = url.trim()
      await writeFile(this.options.urlFile, `${this.url}\n`, 'utf-8').catch(
        () => undefined,
      )
    }
    try {
      const response = await fetch(target, {
        headers: { 'User-Agent': 'work-studio', Accept: 'text/markdown' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const markdown = await response.text()
      const entries = parseCatalogMarkdown(markdown)
      await this.writeCache(markdown)
      return {
        entries,
        url: target,
        fetchedAt: Date.now(),
        stale: false,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('catalog fetch failed', target, message)
      const cached = await this.readCache()
      return {
        entries: cached ? parseCatalogMarkdown(cached) : [],
        url: target,
        fetchedAt: null,
        stale: true,
        error: message,
      }
    }
  }

  private async writeCache(markdown: string): Promise<void> {
    const tmp = `${this.options.cacheFile}.tmp`
    await writeFile(tmp, markdown, 'utf-8')
    await rename(tmp, this.options.cacheFile)
  }

  private readCache(): Promise<string | null> {
    return readFile(this.options.cacheFile, 'utf-8').catch(() => null)
  }
}

/** 解析 Markdown：标题 → 分类，表格 → 条目。 */
export function parseCatalogMarkdown(markdown: string): CatalogEntry[] {
  const lines = markdown.split(/\r?\n/)
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  let category = ''
  let inFence = false
  let header: string[] | null = null

  const flush = (): void => {
    header = null
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      flush()
      continue
    }
    if (inFence) continue
    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading) {
      category = heading[2]!.trim()
      flush()
      continue
    }
    if (!line.startsWith('|')) {
      flush()
      continue
    }
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase())
      continue
    }
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    const row: Record<string, string> = {}
    header.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    if (!REQUIRED.every((key) => row[key])) continue
    if (!ID_RE.test(row.id) || !SOURCE_RE.test(row.source)) continue
    if (seen.has(row.id)) continue
    seen.add(row.id)
    entries.push({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      source: row.source,
      ...(row.icon ? { icon: row.icon } : {}),
      tags: (row.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      category: category || '其他',
    })
  }
  return entries
}
