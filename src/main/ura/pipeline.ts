// ─── 资源管道 ────────────────────────────────────────────────────────
//
// 分发只查表：协议 → 来源 → 格式（按提示）→ 结构化文档；出口由门面选择。
// 不探测内容、不试错组合：任一环缺失或失败即降级 raw。
// 写路径：按资源键串行 → 版本校验 → 提交 → 失效缓存 → 广播。

import type {
  ChangeEvent,
  Codec,
  DecodedDoc,
  DocType,
  Patch,
  RawContent,
  Transport,
  WatchHandle,
} from '../../shared/ura'
import { parseRef } from '../../shared/ura'
import { UraError } from './errors'
import { UraRegistry, uraRegistry } from './registry'

export interface Opened {
  ref: string
  capabilities: string[]
  raw: RawContent
  codec: Codec | null
  decoded: DecodedDoc | null
  degraded: boolean
}

export interface WriteResult {
  version: string
}

type Listener = (event: ChangeEvent) => void

interface Subscription {
  listeners: Set<Listener>
  stop?: () => void
}

export class ResourcePipeline {
  private readonly cache = new Map<string, Opened>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(private readonly registry: UraRegistry = uraRegistry) {}

  // ─── 读 ────────────────────────────────────────────────────────

  async open(ref: string, docTypeHint?: DocType): Promise<Opened> {
    const transport = this.requireTransport(ref)
    const raw = await transport.read(ref)
    const cacheKey = `${ref}|${docTypeHint ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.raw.version === raw.version) return cached

    const codec = this.registry.codecForHints(raw.formatHints, docTypeHint)
    let decoded: DecodedDoc | null = null
    let degraded = false
    if (codec) {
      try {
        decoded = await codec.decode(raw, ref)
      } catch (error) {
        degraded = true
        this.note('warn', 'codec.decode-failed', `${ref}：${messageOf(error)}`)
      }
    } else {
      degraded = true
      this.note('info', 'codec.missing', `${ref} → raw（提示：${raw.formatHints.join(',') || '无'}）`)
    }

    const opened: Opened = {
      ref,
      capabilities: transport.capabilities ?? [],
      raw,
      codec: decoded ? (codec ?? null) : null,
      decoded,
      degraded,
    }
    this.cache.set(cacheKey, opened)
    return opened
  }

  // ─── 写 ────────────────────────────────────────────────────────

  async write(
    ref: string,
    patch: Patch,
    opts: { expectedVersion?: string } = {},
  ): Promise<WriteResult> {
    return this.runExclusive(ref, async () => {
      const transport = this.requireTransport(ref)
      const result = await transport.write(ref, patch, {
        expectedVersion: opts.expectedVersion,
      })
      this.invalidate(ref)
      this.emit({ ref, type: 'content', version: result.version, at: Date.now() })
      return { version: result.version }
    })
  }

  // ─── 监听 ──────────────────────────────────────────────────────

  watch(ref: string, listener: Listener): WatchHandle {
    let subscription = this.subscriptions.get(ref)
    if (!subscription) {
      subscription = { listeners: new Set() }
      const transport = this.registry.transportFor(parseRef(ref).scheme)
      if (transport?.watch) {
        subscription.stop = transport.watch(ref, (event) => {
          this.invalidate(event.ref)
          this.emit(event)
        })
      }
      this.subscriptions.set(ref, subscription)
    }
    subscription.listeners.add(listener)
    const current = subscription
    return {
      ref,
      close: () => {
        current.listeners.delete(listener)
        if (current.listeners.size === 0) {
          current.stop?.()
          this.subscriptions.delete(ref)
        }
      },
    }
  }

  // ─── 内部 ──────────────────────────────────────────────────────

  transportFor(ref: string): Transport | undefined {
    return this.registry.transportFor(parseRef(ref).scheme)
  }

  private requireTransport(ref: string): Transport {
    const transport = this.transportFor(ref)
    if (!transport) {
      throw new UraError(
        'transport.missing',
        `没有注册来源：${parseRef(ref).scheme}`,
      )
    }
    return transport
  }

  private invalidate(ref: string): void {
    for (const key of this.cache.keys()) {
      if (key === ref || key.startsWith(`${ref}|`)) this.cache.delete(key)
    }
  }

  private emit(event: ChangeEvent): void {
    for (const [ref, subscription] of this.subscriptions) {
      if (event.ref !== ref && !event.ref.startsWith(`${ref.replace(/\/$/, '')}/`)) continue
      for (const listener of subscription.listeners) listener(event)
    }
  }

  private runExclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(run, run)
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  private note(level: 'info' | 'warn' | 'error', code: string, message: string): void {
    this.registry.diagnosticsFor(level, code, message)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

