/**
 * 网页快照缓存：数据根下按 URL 哈希落盘。
 *
 * 自动快照进缓存，保存后才成为工作区资源；缓存可随时丢弃。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeJson } from '../platform/json.ts';

export interface SnapshotDoc {
  url: string;
  title: string;
  markdown: string;
  capturedAt: number;
  /** Readability 式概述（description 或正文首段）。 */
  excerpt?: string;
  /** 站点图标（页面声明或 /favicon.ico）；旧缓存没有这一项。 */
  icon?: string;
  /** 工作区里的 Markdown 快照文件；写成功后才有可能有。 */
  fileRef?: string;
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

  /** 记录快照文件地址：清单打开时优先用文件，旧缓存没有就走只读视图。 */
  attachFile(url: string, fileRef: string): void {
    const key = this.fileOf(sourceUrlOf(url));
    const doc = readJsonFile<SnapshotDoc>(key);
    if (!doc) return;
    writeJson(key, { ...doc, fileRef });
  }

  /** 删除一份缓存快照；不存在也算成功。 */
  remove(url: string): void {
    rmSync(this.fileOf(sourceUrlOf(url)), { force: true });
  }

  /** 删除某个域名的全部快照（缓存文件）。 */
  removeDomain(domain: string): void {
    for (const doc of this.list()) {
      try {
        if (new URL(doc.url).hostname === domain) this.remove(doc.url);
      } catch {
        /* 坏地址跳过 */
      }
    }
  }

  /** 缓存清单：只读目录，按采集时间倒序；坏文件直接跳过。 */
  list(): SnapshotDoc[] {
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch {
      return [];
    }
    const docs: SnapshotDoc[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const doc = readJsonFile<SnapshotDoc>(join(this.directory, name));
      if (!doc || typeof doc.url !== 'string') continue;
      if (typeof doc.markdown !== 'string') continue;
      docs.push(doc);
    }
    return docs.sort((a, b) => b.capturedAt - a.capturedAt);
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
