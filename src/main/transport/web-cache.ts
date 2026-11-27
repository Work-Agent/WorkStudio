/**
 * 网页快照缓存：数据根下按 URL 哈希落盘。
 *
 * 自动快照进缓存，保存后才成为工作区资源；缓存可随时丢弃。
 */

import { createHash } from 'node:crypto';
import { snapshotFileName, snapshotKey } from './snapshot-doc.ts';
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

  /** 快照的资源地址：域 → 页两级，`.md` 后缀让 markdown 插件认领。 */
  refOfPage(url: string): string {
    return `sites://${snapshotFileName(url)}`;
  }

  /** 快照文档 → 资源地址；优先用已落盘的文件名，保证同一页只有一个地址。 */
  refOfDoc(doc: SnapshotDoc): string {
    const file = doc.fileRef ?? '';
    const marker = '/sites/';
    const index = file.indexOf(marker);
    if (index >= 0) return `sites://${file.slice(index + marker.length)}`;
    return this.refOfPage(doc.url);
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

  /** 删除某个域名的全部快照（按目录逐个删，含旧 key 的残留文件）。 */
  removeDomain(domain: string): void {
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.directory, name);
      const doc = readJsonFile<SnapshotDoc>(path);
      if (!doc || typeof doc.url !== 'string') continue;
      try {
        if (new URL(doc.url).hostname === domain) rmSync(path, { force: true });
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
    docs.sort((a, b) => b.capturedAt - a.capturedAt);
    // 快照身份是 origin + pathname：同一页的不同 query 只保留最新一份。
    const seen = new Set<string>();
    return docs.filter((doc) => {
      const key = pageKey(doc.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private fileOf(url: string): string {
    const key = createHash('sha1').update(pageKey(url)).digest('hex');
    return join(this.directory, `${key}.json`);
  }
}

/** 快照身份：origin + pathname；无法解析时退回原值。 */
function pageKey(value: string): string {
  try {
    return snapshotKey(sourceUrlOf(value));
  } catch {
    return value;
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
