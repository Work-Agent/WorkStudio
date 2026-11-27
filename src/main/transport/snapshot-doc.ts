/**
 * 快照文档：文件名与正文都由这里生成。
 *
 * 身份 = origin + pathname：query / hash 只是同一页的不同参数，
 * 重抓（哪怕换了 query）都更新同一份快照。文件名 = 域 / 路径 slug + 身份哈希；
 * 正文 = 头部（url / title / excerpt / domain / capturedAt / icon）+ Markdown。
 */

import { createHash } from 'node:crypto';
import type { SnapshotDoc } from './web-cache.ts';

/** 快照身份：协议 + 主机 + 路径；query / hash 不参与。 */
export function snapshotKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/** 文件名 = 域 / 路径 slug + 身份哈希：同一页（含不同 query）只有一份。 */
export function snapshotFileName(url: string): string {
  const parsed = new URL(url);
  const domain = parsed.hostname || 'site';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const tail = segments.at(-1) ?? 'index';
  const slug =
    tail
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .slice(0, 48) || 'index';
  const hash = createHash('sha1')
    .update(snapshotKey(url))
    .digest('hex')
    .slice(0, 8);
  return `${domain}/${slug}-${hash}.md`;
}

/** 快照文件：头部固定来源信息，正文是提取出来的 Markdown。 */
export function snapshotMarkdown(doc: {
  url: string;
  title: string;
  excerpt?: string;
  markdown: string;
  capturedAt: number;
  icon?: string;
}): string {
  const domain = (() => {
    try {
      return new URL(doc.url).hostname;
    } catch {
      return '';
    }
  })();
  const front = [
    '---',
    `url: ${JSON.stringify(doc.url)}`,
    `title: ${JSON.stringify(doc.title)}`,
    ...(doc.excerpt ? [`excerpt: ${JSON.stringify(doc.excerpt)}`] : []),
    `domain: ${JSON.stringify(domain)}`,
    `capturedAt: ${JSON.stringify(new Date(doc.capturedAt).toISOString())}`,
    ...(doc.icon ? [`icon: ${JSON.stringify(doc.icon)}`] : []),
    '---',
    '',
    '',
  ].join('\n');
  return `${front}${doc.markdown.trim()}\n`;
}
