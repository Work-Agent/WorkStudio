// ─── 写会话注册表 ────────────────────────────────────────────────────
//
// 页面侧的多步编辑：open → stage → commit / abort。
// 草稿只存在于主进程内存，不落盘、不进投影、不进模型上下文。

import { randomUUID } from 'node:crypto';
import type { Change, CommitResult } from '../../shared/ura';
import type { Ura } from './facade';
import type { WriteSession } from './write-session';

interface Entry {
  session: WriteSession;
  ref: string;
  timer: NodeJS.Timeout;
}

const TTL_MS = 10 * 60 * 1000;

export class WriteSessionRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ura: Ura) {}

  async open(
    ref: string,
  ): Promise<{ id: string; ref: string; dirty: boolean }> {
    const session = await this.ura.openWrite(ref);
    const id = randomUUID();
    this.entries.set(id, { session, ref, timer: this.timer(id) });
    return { id, ref, dirty: session.dirty };
  }

  stage(id: string, change: Change): { dirty: boolean } {
    const entry = this.require(id);
    entry.session.stage(change);
    this.touch(id, entry);
    return { dirty: entry.session.dirty };
  }

  async commit(id: string): Promise<CommitResult> {
    const entry = this.require(id);
    try {
      return await entry.session.commit();
    } finally {
      this.close(id);
    }
  }

  abort(id: string): void {
    this.require(id).session.abort();
    this.close(id);
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`写会话不存在：${id}`);
    return entry;
  }

  private touch(id: string, entry: Entry): void {
    clearTimeout(entry.timer);
    entry.timer = this.timer(id);
  }

  private timer(id: string): NodeJS.Timeout {
    const timer = setTimeout(() => this.close(id), TTL_MS);
    timer.unref?.();
    return timer;
  }

  private close(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(id);
  }

  /** 工作区切换 / 退出：丢弃全部草稿（不落盘）。 */
  disposeAll(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}
