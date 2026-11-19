// ─── 网站快照（白名单域整理） ────────────────────────────────────────
//
// 只有白名单域（含子域）的页面才落盘；白名单属工作区策略（settings.json 的
// workspaceStudio.browser.allowlist）。快照是已解码的 Markdown：
// 头部 = url + Readability 的 title / excerpt，正文 = Readability 正文，
// 尾部 = 可访问性结构。落在应用管理的 sites/<domain>/ 下，只有浏览器写入。

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fileRef } from '../../../shared/ura.ts';
import { getWorkspaceId } from '../agent/workspace.ts';
import type { BrowserSnapshot } from '../harness/browser-contract.ts';
import { readBrowserAllowlist } from '../../infrastructure/preferences.ts';
import type { Ura } from '../ura/facade.ts';

/** 快照头部：列表行（标题 / 网址）与「打开在线页面」的唯一依据。 */
export interface SnapshotHead {
  url?: string;
  title?: string;
  domain?: string;
}

export class SiteSnapshots {
  constructor(
    private readonly ura: Ura,
    private readonly workspace: () => string,
  ) {}

  /** 白名单域才整理；返回快照资源 id。 */
  async capture(page: BrowserSnapshot): Promise<{ ref: string } | null> {
    const domain = domainOf(page.url);
    if (!domain) return null;
    const allowlist = readBrowserAllowlist(getWorkspaceId(this.workspace()));
    if (!allowlisted(domain, allowlist)) return null;

    const root = fileRef(this.workspace());
    const ref = `${root}/sites/${domain}/${slugOf(page.url)}.md`;
    await this.ura.write(ref, render(page, domain));
    headCache.delete(ref);
    return { ref };
  }
}

/** 域是否落在白名单条目内（含子域）：采集与列表共用同一判定。 */
export function allowlisted(
  domain: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.some((entry) => matches(domain, entry));
}

/**
 * 读快照头部（frontmatter）：列表只关心 title / url / domain，不读正文。
 * 带短 TTL 缓存，避免每次列表快照都重读全部文件。
 */
export async function readSnapshotHead(ref: string): Promise<SnapshotHead> {
  const now = Date.now();
  const hit = headCache.get(ref);
  if (hit && now - hit.at < HEAD_TTL_MS) return hit.value;
  let value: SnapshotHead = {};
  if (ref.startsWith('file://')) {
    try {
      const handle = await open(fileURLToPath(ref), 'r');
      try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
        value = parseHead(buffer.toString('utf8', 0, bytesRead));
      } finally {
        await handle.close();
      }
    } catch {
      value = {};
    }
  }
  headCache.set(ref, { at: now, value });
  return value;
}

const HEAD_BYTES = 4096;
const HEAD_TTL_MS = 5_000;
const headCache = new Map<string, { at: number; value: SnapshotHead }>();

/** 快照头部是 `key: value` 行；只取 url / title / domain，正文不参与。 */
function parseHead(text: string): SnapshotHead {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const head: SnapshotHead = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!value) continue;
    if (key === 'url') head.url = value;
    else if (key === 'title') head.title = value;
    else if (key === 'domain') head.domain = value;
  }
  return head;
}

function domainOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matches(domain: string, entry: string): boolean {
  const normalized = entry.trim().toLowerCase().replace(/^\./, '');
  if (!normalized) return false;
  return domain === normalized || domain.endsWith(`.${normalized}`);
}

function slugOf(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8);
  return `${path || 'index'}-${hash}`;
}

function render(page: BrowserSnapshot, domain: string): string {
  const lines = [
    '---',
    `url: ${page.url}`,
    `title: ${oneLine(page.title)}`,
    `excerpt: ${oneLine(page.excerpt)}`,
    `domain: ${domain}`,
    `capturedAt: ${new Date().toISOString()}`,
    '---',
    '',
    page.markdown.trim(),
  ];
  if (page.a11y.length > 0) {
    lines.push('', '## 可访问性结构', '', ...page.a11y);
  }
  return `${lines.join('\n')}\n`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
