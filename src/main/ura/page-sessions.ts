// ─── 页面会话 ────────────────────────────────────────────────────────
//
// 页面会话 = 打开 → 就绪 → 投递 → 脏态 / 提交 → 释放。
// 主进程独占生命周期：页面只拿 id、入口与数据，不拿版本 token 之外的内部状态。
// 保存是严格写：基线 = 投递时的版本；冲突返回 base / current / mine。

import { randomUUID } from 'node:crypto'
import type { CommitResult, DocType } from '../../shared/ura'
import { VersionConflictError } from './errors'
import type { Ura } from './facade'

export type PageOpenTarget =
  | { type: 'browser'; url: string }
  | { type: 'page'; info: PageSessionInfo }

export interface PageSessionInfo {
  id: string
  ref: string
  version: string
  docType: DocType | null
  surface: string
  owner?: string
  page: string
  data: unknown
  degraded: boolean
}

interface Entry {
  info: PageSessionInfo
  base: string
  closed: boolean
}

export class PageSessions {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly ura: Ura) {}

  async open(ref: string): Promise<PageOpenTarget> {
    const opened = await this.ura.read(ref, { as: 'editor' })
    if (opened.projection.type === 'browser') {
      return { type: 'browser', url: opened.projection.url }
    }
    if (opened.projection.type !== 'page') {
      throw new Error(`资源没有页面出口：${ref}`)
    }
    const base = await this.textOf(ref)
    const info: PageSessionInfo = {
      id: randomUUID(),
      ref,
      version: opened.version,
      docType: opened.docType,
      surface: opened.projection.surface,
      ...(opened.projection.owner ? { owner: opened.projection.owner } : {}),
      page: opened.projection.page,
      data: opened.projection.data,
      degraded: opened.degraded,
    }
    this.entries.set(info.id, { info, base, closed: false })
    return { type: 'page', info }
  }

  get(id: string): PageSessionInfo {
    return this.require(id).info
  }

  async save(id: string, content: string): Promise<CommitResult> {
    const entry = this.require(id)
    try {
      const { version } = await this.ura.write(entry.info.ref, content, {
        expectedVersion: entry.info.version,
      })
      entry.info = { ...entry.info, version }
      entry.base = content
      return { ok: true, version }
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error
      return {
        ok: false,
        conflict: {
          base: entry.base,
          current: await this.textOf(entry.info.ref),
          mine: content,
        },
      }
    }
  }

  /** 重新投递（冲突弃稿 / 外部变更后对齐）。 */
  async reload(id: string): Promise<PageSessionInfo> {
    const entry = this.require(id)
    const opened = await this.ura.read(entry.info.ref, { as: 'editor' })
    if (opened.projection.type !== 'page') {
      throw new Error(`资源没有页面出口：${entry.info.ref}`)
    }
    entry.info = {
      ...entry.info,
      version: opened.version,
      docType: opened.docType,
      surface: opened.projection.surface,
      ...(opened.projection.owner ? { owner: opened.projection.owner } : {}),
      page: opened.projection.page,
      data: opened.projection.data,
      degraded: opened.degraded,
    }
    entry.base = await this.textOf(entry.info.ref)
    return entry.info
  }

  close(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.closed = true
    this.entries.delete(id)
  }

  private async textOf(ref: string): Promise<string> {
    const opened = await this.ura.read(ref, { as: 'agent' })
    return opened.projection.type === 'text' ? opened.projection.content : ''
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry || entry.closed) throw new Error(`页面会话不存在：${id}`)
    return entry
  }
}
