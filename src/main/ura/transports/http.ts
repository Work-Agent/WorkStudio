// ─── 内置来源：http(s) ──────────────────────────────────────────────
//
// 共享浏览器 partition 的 session（cookie / 代理 / 认证）；
// 格式提示来自响应 Content-Type，URL 扩展名兜底；不做内容嗅探。
// 只读：API 变更属于操作型能力，不走资源写入。

import { createHash } from 'node:crypto'
import { session } from 'electron'
import type {
  RawContent,
  ResourceStat,
  Transport,
  TransportWriteOptions,
  TransportWriteResult,
} from '../../../shared/ura'
import { UraError } from '../errors'

const PARTITION = 'persist:workstudio:browser'

const EXT_HINTS: Record<string, string[]> = {
  md: ['markdown', 'text'],
  markdown: ['markdown', 'text'],
  html: ['html', 'text'],
  htm: ['html', 'text'],
  json: ['json', 'text'],
  xml: ['xml', 'text'],
  csv: ['table', 'text'],
  tsv: ['table', 'text'],
}

export class HttpTransport implements Transport {
  readonly capabilities = ['read', 'live']

  constructor(readonly scheme: 'http' | 'https') {}

  async stat(ref: string): Promise<ResourceStat> {
    const response = await this.net().fetch(ref, { method: 'HEAD' })
    if (!response.ok) {
      throw new UraError('http.status', `HTTP ${response.status}: ${ref}`)
    }
    const length = Number(response.headers.get('content-length') ?? 0)
    return {
      version: versionOf(response, null),
      type: 'file',
      size: Number.isFinite(length) ? length : 0,
    }
  }

  async read(ref: string): Promise<RawContent> {
    const response = await this.net().fetch(ref)
    if (!response.ok) {
      throw new UraError('http.status', `HTTP ${response.status}: ${ref}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      bytes,
      version: versionOf(response, bytes),
      type: 'file',
      size: bytes.length,
      formatHints: hintsFor(
        response.headers.get('content-type'),
        response.url || ref,
      ),
      mime: response.headers.get('content-type') ?? undefined,
    }
  }

  async write(
    _ref: string,
    _patch: never,
    _opts: TransportWriteOptions,
  ): Promise<TransportWriteResult> {
    throw new UraError('transport.read-only', 'http 来源只读')
  }

  async list(): Promise<never> {
    throw new UraError('transport.no-list', 'http 来源不支持列目录')
  }

  private net(): Electron.Session {
    return session.fromPartition(PARTITION)
  }
}

function hintsFor(contentType: string | null, url: string): string[] {
  const hints: string[] = []
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime.includes('json')) hints.push('json')
  else if (mime.includes('xml')) hints.push('xml')
  else if (mime.includes('html')) hints.push('html')
  else if (mime === 'text/csv' || mime === 'text/tab-separated-values') {
    hints.push('table')
  } else if (mime.startsWith('text/')) hints.push('text')

  let path = ''
  try {
    path = new URL(url).pathname
  } catch {
    path = url
  }
  const index = path.lastIndexOf('.')
  const ext = index < 0 ? '' : path.slice(index + 1).toLowerCase()
  for (const hint of EXT_HINTS[ext] ?? []) {
    if (!hints.includes(hint)) hints.push(hint)
  }
  return hints.length ? hints : ['binary']
}

function versionOf(response: Response, bytes: Uint8Array | null): string {
  const etag = response.headers.get('etag')
  if (etag) return `etag:${etag.replace(/^W\//, '').replace(/"/g, '')}`
  const modified = response.headers.get('last-modified')
  if (modified) return `lm:${modified}`
  return `hash:${createHash('sha1').update(bytes ?? new Uint8Array()).digest('hex').slice(0, 16)}`
}
