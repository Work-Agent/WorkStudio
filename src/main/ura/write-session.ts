// ─── 写会话 ──────────────────────────────────────────────────────────
//
// 草稿不落盘、不进投影、不进模型上下文；提交才产生资源写入。
// 提交 = 基线 → 最小补丁 → 版本校验；冲突返回 base / current / mine。

import type { Change, CommitResult, Patch } from '../../shared/ura'
import { VersionConflictError } from './errors'
import { ResourcePipeline, type Opened } from './pipeline'
import type { UraError } from './errors'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class WriteSession {
  private readonly base: string
  private draft: string
  private closed = false

  private constructor(
    private readonly pipeline: ResourcePipeline,
    readonly ref: string,
    private readonly baseVersion: string,
    base: string,
  ) {
    this.base = base
    this.draft = base
  }

  static async open(pipeline: ResourcePipeline, ref: string): Promise<WriteSession> {
    const opened = await pipeline.open(ref)
    return new WriteSession(pipeline, ref, opened.raw.version, textOf(opened))
  }

  get dirty(): boolean {
    return this.draft !== this.base
  }

  /** 在草稿上应用一次变更（偏移以草稿为准）。 */
  stage(change: Change): void {
    this.assertOpen()
    if (change.type === 'replace-all') {
      this.draft = textOfContent(change.content)
      return
    }
    const { anchor } = change
    const text = textOfContent(change.content)
    if (anchor.start < 0 || anchor.end > this.draft.length || anchor.start > anchor.end) {
      throw new Error(`锚点越界：${anchor.start}-${anchor.end}`)
    }
    if (anchor.expected !== undefined) {
      const actual = this.draft.slice(anchor.start, anchor.end)
      if (actual !== anchor.expected) {
        throw new Error('锚点基线不匹配')
      }
    }
    this.draft =
      this.draft.slice(0, anchor.start) + text + this.draft.slice(anchor.end)
  }

  /** 就地校验：不匹配直接失败（严格写会话）。 */
  apply(anchor: { start: number; end: number; expected?: string }): void {
    this.assertOpen()
    if (anchor.expected !== undefined) {
      const actual = this.draft.slice(anchor.start, anchor.end)
      if (actual !== anchor.expected) throw new Error('锚点基线不匹配')
    }
  }

  async commit(): Promise<CommitResult> {
    this.assertOpen()
    this.closed = true
    if (!this.dirty) return { ok: true, version: this.baseVersion }

    const patch = minimalPatch(this.base, this.draft)
    try {
      const { version } = await this.pipeline.write(this.ref, patch, {
        expectedVersion: this.baseVersion,
      })
      return { ok: true, version }
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error
      const current = await this.pipeline.open(this.ref)
      return {
        ok: false,
        conflict: {
          base: this.base,
          current: textOf(current),
          mine: this.draft,
        },
      }
    }
  }

  abort(): void {
    this.closed = true
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('写会话已结束')
  }
}

/** 基线 → 草稿的最小补丁：公共前后缀之外的片段。 */
export function minimalPatch(base: string, next: string): Patch {
  const baseBytes = encoder.encode(base)
  const nextBytes = encoder.encode(next)
  let prefix = 0
  const max = Math.min(baseBytes.length, nextBytes.length)
  while (prefix < max && baseBytes[prefix] === nextBytes[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    baseBytes[baseBytes.length - 1 - suffix] === nextBytes[nextBytes.length - 1 - suffix]
  ) {
    suffix++
  }
  return {
    type: 'replace-range',
    start: prefix,
    end: baseBytes.length - suffix,
    bytes: nextBytes.slice(prefix, nextBytes.length - suffix),
  }
}

function textOf(opened: Opened): string {
  const projection = opened.decoded?.projection
  if (typeof projection === 'string') return projection
  return decoder.decode(opened.raw.bytes)
}

function textOfContent(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : decoder.decode(content)
}

export type { UraError }
