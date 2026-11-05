// ─── 页面会话 ────────────────────────────────────────────────────────
//
// 页面会话 = 打开 → 就绪 → 投递 → 脏态 / 提交 → 释放。
// 主进程独占生命周期：页面只拿 id、入口与数据，不拿版本 token 之外的内部状态。
// 保存按队列写入，后写覆盖先写。

import { randomUUID } from 'node:crypto';
import type { CommitResult } from '../../shared/ura';
import type { Ura } from './facade';

export type PageOpenTarget =
  | { type: 'browser'; url: string }
  | { type: 'page'; info: PageSessionInfo };

export interface PageSessionInfo {
  id: string;
  ref: string;
  version: string;
  codec: string | null;
  surface: string;
  owner?: string;
  page: string;
  data: unknown;
  degraded: boolean;
}

interface Entry {
  info: PageSessionInfo;
  /** 文本基线，或二进制内容的 base64（见 encoding）。 */
  base: string;
  encoding: 'text' | 'base64';
  closed: boolean;
}

export class PageSessions {
  private readonly entries = new Map<string, Entry>();
  /** ref → pageId：同一资源在会话存活期间复用同一页面。 */
  private readonly byRef = new Map<string, string>();

  constructor(private readonly ura: Ura) {}

  async open(ref: string): Promise<PageOpenTarget> {
    const opened = await this.ura.read(ref, { as: 'editor' });
    if (opened.presentation.type === 'browser') {
      return { type: 'browser', url: opened.presentation.url };
    }
    if (opened.presentation.type !== 'page') {
      throw new Error(`资源没有页面出口：${ref}`);
    }
    if (!opened.presentation.page) {
      throw new Error(`无可用查看器：${ref}`);
    }
    const binary = isBinaryRef(ref);
    const base = await this.baseOf(ref, binary);
    const existingId = this.byRef.get(ref);
    const existing = existingId ? this.entries.get(existingId) : undefined;
    if (!existing || existing.closed) this.byRef.delete(ref);
    // 复用已有页面：内容按最新版本重建，id 保持不变。
    const info: PageSessionInfo = {
      id: existing && !existing.closed ? existing.info.id : randomUUID(),
      ref,
      version: opened.version,
      codec: opened.codec,
      surface: opened.presentation.surface,
      ...(opened.presentation.owner
        ? { owner: opened.presentation.owner }
        : {}),
      page: opened.presentation.page,
      data: opened.presentation.data,
      degraded: opened.degraded,
    };
    this.entries.set(info.id, {
      info,
      base,
      encoding: binary ? 'base64' : 'text',
      closed: false,
    });
    this.byRef.set(ref, info.id);
    return { type: 'page', info };
  }

  get(id: string): PageSessionInfo {
    return this.require(id).info;
  }

  async save(id: string, content: string | Uint8Array): Promise<CommitResult> {
    const entry = this.require(id);
    const binary = content instanceof Uint8Array;
    const { version } = await this.ura.write(entry.info.ref, content);
    entry.info = { ...entry.info, version };
    entry.base = binary ? base64Of(content) : content;
    entry.encoding = binary ? 'base64' : 'text';
    return { ok: true, version };
  }

  /** 二进制页面内容（Office 等 OOXML 文档）；冲突稿同样以 base64 返回。 */
  async saveBytes(id: string, bytes: Uint8Array): Promise<CommitResult> {
    return this.save(id, bytes);
  }

  /** 重新投递（冲突弃稿 / 外部变更后对齐）。 */
  async reload(id: string): Promise<PageSessionInfo> {
    const entry = this.require(id);
    const opened = await this.ura.read(entry.info.ref, { as: 'editor' });
    if (opened.presentation.type !== 'page') {
      throw new Error(`资源没有页面出口：${entry.info.ref}`);
    }
    if (!opened.presentation.page) {
      throw new Error(`无可用查看器：${entry.info.ref}`);
    }
    entry.info = {
      ...entry.info,
      version: opened.version,
      codec: opened.codec,
      surface: opened.presentation.surface,
      ...(opened.presentation.owner
        ? { owner: opened.presentation.owner }
        : {}),
      page: opened.presentation.page,
      data: opened.presentation.data,
      degraded: opened.degraded,
    };
    entry.base = await this.baseOf(entry.info.ref, entry.encoding === 'base64');
    return entry.info;
  }

  close(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.closed = true;
    this.entries.delete(id);
    if (this.byRef.get(entry.info.ref) === id) {
      this.byRef.delete(entry.info.ref);
    }
  }

  /** 工作区切换 / 退出：释放全部页面会话。 */
  disposeAll(): void {
    for (const entry of this.entries.values()) entry.closed = true;
    this.entries.clear();
    this.byRef.clear();
  }

  private async textOf(ref: string): Promise<string> {
    const opened = await this.ura.read(ref, { as: 'agent' });
    return opened.presentation.type === 'text'
      ? opened.presentation.content
      : '';
  }

  private async baseOf(ref: string, binary: boolean): Promise<string> {
    if (binary) return base64Of((await this.ura.readBytes(ref)).bytes);
    return this.textOf(ref);
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.closed) throw new Error(`页面会话不存在：${id}`);
    return entry;
  }
}

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

const BINARY_EXT =
  /\.(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|potx|pdf|zip|png|jpe?g|gif|webp|mp4|mp3)$/i;

function isBinaryRef(ref: string): boolean {
  try {
    return BINARY_EXT.test(new URL(ref).pathname);
  } catch {
    return BINARY_EXT.test(ref);
  }
}
