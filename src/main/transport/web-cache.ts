/**
 * 网页快照缓存：数据根下按 URL 哈希落盘。
 *
 * 自动快照进缓存，保存后才成为工作区资源；缓存可随时丢弃。
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJson } from '../platform/json.ts';

export interface SnapshotDoc {
  url: string;
  title: string;
  markdown: string;
  capturedAt: number;
}

export class WebCache {
  constructor(readonly directory: string) {}

  /** 快照的只读投影地址；来源地址与资源地址不重合。 */
  refOf(url: string): string {
    return `work://studio/snapshot?url=${encodeURIComponent(url)}`;
  }

  async get(url: string): Promise<SnapshotDoc | null> {
    const doc = readJsonFile<SnapshotDoc>(this.fileOf(sourceUrlOf(url)));
    if (!doc || typeof doc.markdown !== 'string') return null;
    return doc;
  }

  async save(doc: SnapshotDoc): Promise<{ ref: string }> {
    mkdirSync(this.directory, { recursive: true });
    writeJson(this.fileOf(doc.url), doc);
    return { ref: this.refOf(doc.url) };
  }

  private fileOf(url: string): string {
    const key = createHash('sha1').update(url).digest('hex');
    return join(this.directory, `${key}.json`);
  }
}

/** 快照 ref → 原始 URL；其它地址原样。 */
function sourceUrlOf(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'work:' && url.hostname === 'studio') {
      const source = url.searchParams.get('url');
      if (source) return source;
    }
  } catch {
    /* keep */
  }
  return value;
}
