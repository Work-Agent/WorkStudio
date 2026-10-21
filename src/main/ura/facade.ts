// ─── URA 门面 ────────────────────────────────────────────────────────
//
// 人（页面）、AI（工具）、插件（实现）共用同一组入口：只拿统一标识，不拿路径与句柄。
// 门面只做编排：选来源、选格式、选出口、拼结果；不含格式解释与来源访问。

import type {
  AgentProjection,
  TreeItem,
  Caller,
  EditorProjection,
  ListEntry,
  OpenResult,
  Query,
  ReadOptions,
  WatchHandle,
  Change,
} from '../../shared/ura'
import { parseRef } from '../../shared/ura'
import { UraError } from './errors'
import { ResourcePipeline, type Opened } from './pipeline'
import { UraRegistry, uraRegistry } from './registry'
import { WriteSession } from './write-session'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type PageResolver = (surface: string, owner?: string) => string | null

export interface GrepMatch {
  ref: string
  line: number
  text: string
}

export interface GrepOptions {
  scope?: string
  ignoreCase?: boolean
  limit?: number
}

export interface FindOptions {
  scope?: string
  limit?: number
}

const MAX_SCAN_FILES = 500
const MAX_SCAN_BYTES = 4 * 1024 * 1024

export class Ura {
  constructor(
    private readonly pipeline: ResourcePipeline = new ResourcePipeline(),
    private readonly registry: UraRegistry = uraRegistry,
    private readonly resolvePage: PageResolver = () => null,
  ) {}

  // ─── 读 ────────────────────────────────────────────────────────

  async read(ref: string, options: ReadOptions = {}): Promise<OpenResult> {
    const opened = await this.pipeline.open(ref, options.docTypeHint)
    const as: Caller = options.as ?? 'agent'
    const projection =
      as === 'editor'
        ? await this.editorProjection(opened)
        : await this.textProjection(opened, options.window)
    return {
      ref,
      version: opened.raw.version,
      docType: opened.decoded?.docType ?? null,
      formatHints: opened.raw.formatHints,
      degraded: opened.degraded,
      projection,
    }
  }

  // ─── 写 ────────────────────────────────────────────────────────

  async write(
    ref: string,
    content: string | Uint8Array,
    opts: { expectedVersion?: string } = {},
  ): Promise<{ version: string }> {
    return this.pipeline.write(
      ref,
      { type: 'replace-all', bytes: toBytes(content) },
      opts,
    )
  }

  /** 锚定替换（单步写）：定位 → 编码 → 提交。 */
  async edit(
    ref: string,
    anchor: { start: number; end: number; expected?: string },
    content: string | Uint8Array,
  ): Promise<{ version: string }> {
    const opened = await this.pipeline.open(ref)
    if (opened.codec && opened.decoded) {
      const span = opened.codec.locate(opened.decoded, anchor)
      const patch = opened.codec.encode(opened.decoded, {
        type: 'replace-range',
        anchor: { ...anchor, ...span },
        content,
      })
      return this.pipeline.write(ref, patch, {
        expectedVersion: opened.raw.version,
      })
    }
    return this.pipeline.write(
      ref,
      {
        type: 'replace-range',
        start: anchor.start,
        end: anchor.end,
        bytes: toBytes(content),
        expected: anchor.expected,
      },
      { expectedVersion: opened.raw.version },
    )
  }

  openWrite(ref: string): Promise<WriteSession> {
    return WriteSession.open(this.pipeline, ref)
  }

  // ─── 清单 / 检索 ───────────────────────────────────────────────

  async ls(ref: string): Promise<ListEntry[]> {
    const transport = this.pipeline.transportFor(ref)
    if (!transport) throw new UraError('transport.missing', `没有注册来源：${parseRef(ref).scheme}`)
    return transport.list(ref)
  }

  async find(pattern: string, options: FindOptions = {}): Promise<ListEntry[]> {
    const root = options.scope ?? 'file:///'
    const matcher = globToRegExp(pattern)
    const limit = options.limit ?? 200
    const results: ListEntry[] = []
    for await (const entry of this.walk(root)) {
      if (entry.type !== 'file') continue
      const name = entry.ref.slice(entry.ref.lastIndexOf('/') + 1)
      if (!matcher.test(name) && !matcher.test(entry.ref)) continue
      results.push(entry)
      if (results.length >= limit) break
    }
    return results
  }

  async grep(pattern: string, options: GrepOptions = {}): Promise<GrepMatch[]> {
    const root = options.scope ?? 'file:///'
    const regex = new RegExp(pattern, options.ignoreCase ? 'i' : '')
    const limit = options.limit ?? 100
    const matches: GrepMatch[] = []
    let scanned = 0
    let bytes = 0
    for await (const entry of this.walk(root)) {
      if (entry.type !== 'file') continue
      if (scanned++ >= MAX_SCAN_FILES || bytes >= MAX_SCAN_BYTES) break
      let opened: Opened
      try {
        opened = await this.pipeline.open(entry.ref)
      } catch {
        continue
      }
      bytes += opened.raw.bytes.length
      const text = textOf(opened)
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i]!)) continue
        matches.push({ ref: entry.ref, line: i + 1, text: lines[i]! })
        if (matches.length >= limit) return matches
      }
    }
    return matches
  }

  async query(ref: string, query: Query): Promise<unknown> {
    const opened = await this.pipeline.open(ref)
    const docType = opened.decoded?.docType
    if (!docType) throw new UraError('query.no-document', `资源未解析：${ref}`)
    const store = this.registry.storeFor(docType)
    if (!store) throw new UraError('query.no-store', `文档类型没有结构化数据：${docType}`)
    return store.query(opened.decoded!, query)
  }

  /** 资源树（渲染层投影；不含内容）。 */
  async tree(ref: string, limit = 2000): Promise<TreeItem[]> {
    const items: TreeItem[] = []
    for await (const entry of this.walk(ref)) {
      items.push({
        ref: entry.ref,
        name: entry.name,
        type: entry.type,
        ext: entry.type === 'file' ? extensionOf(entry.name) : '',
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      })
      if (items.length >= limit) break
    }
    return items
  }

  // ─── 监听 ──────────────────────────────────────────────────────

  watch(ref: string, listener: (event: import('../../shared/ura').ChangeEvent) => void): WatchHandle {
    return this.pipeline.watch(ref, listener)
  }

  // ─── 出口 ──────────────────────────────────────────────────────

  private async textProjection(
    opened: Opened,
    window?: ReadOptions['window'],
  ): Promise<AgentProjection> {
    const docType = opened.decoded?.docType
    if (docType) {
      const consumer = this.registry.consumerFor(
        docType,
        'agent',
        opened.capabilities,
      )
      if (consumer) {
        const projection = await consumer.project(opened.decoded!, opened.raw, opened.ref)
        if (projection.type === 'text') return sliceWindow(projection, window)
      }
    }
    const content = textOf(opened)
    return sliceWindow({ type: 'text', content }, window)
  }

  private async editorProjection(opened: Opened): Promise<EditorProjection> {
    const docType = opened.decoded?.docType
    if (docType) {
      const consumer = this.registry.consumerFor(
        docType,
        'editor',
        opened.capabilities,
      )
      if (consumer?.surface) {
        const projection = await consumer.project(
          opened.decoded!,
          opened.raw,
          opened.ref,
        )
        if (projection.type === 'browser') return projection
        if (projection.type === 'page') {
          const owner = this.registry.ownerOfConsumer(
            docType,
            'editor',
            opened.capabilities,
          )
          const page = this.resolvePage(projection.surface, owner)
          return { ...projection, page: page ?? '', ...(owner ? { owner } : {}) }
        }
      }
    }
    return {
      type: 'page',
      surface: 'raw',
      page: '',
      data: { formatHints: opened.raw.formatHints, degraded: true },
    }
  }

  // ─── 遍历 ──────────────────────────────────────────────────────

  private async *walk(root: string): AsyncGenerator<ListEntry> {
    const transport = this.pipeline.transportFor(root)
    if (!transport) return
    const queue = [root]
    while (queue.length) {
      const dir = queue.shift()!
      let entries: ListEntry[]
      try {
        entries = await transport.list(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        yield entry
        if (entry.type === 'dir') queue.push(entry.ref)
      }
    }
  }
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content
}

function textOf(opened: Opened): string {
  const projection = opened.decoded?.projection
  if (typeof projection === 'string') return projection
  return decoder.decode(opened.raw.bytes)
}

function sliceWindow(
  projection: AgentProjection,
  window?: ReadOptions['window'],
): AgentProjection {
  if (!window) return projection
  const start = Math.max(0, window.start ?? 0)
  const end = window.end ?? projection.content.length
  return { ...projection, content: projection.content.slice(start, end) }
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (const char of pattern) {
    if (char === '*') source += '.*'
    else if (char === '?') source += '.'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

export type { Change }
