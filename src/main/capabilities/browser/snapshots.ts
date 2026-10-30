// ─── 网站快照（白名单域整理） ────────────────────────────────────────
//
// 只有白名单域（含子域）的页面才落盘；白名单属工作区策略（settings.json 的
// workspaceStudio.browser.allowlist）。快照是已解码的 Markdown：
// 头部 = url + Readability 的 title / excerpt，正文 = Readability 正文，
// 尾部 = 可访问性结构。落在应用管理的 sites/<domain>/ 下，只有浏览器写入。

import { createHash } from 'node:crypto';
import { fileRef } from '../../../shared/ura';
import { getWorkspaceId } from '../../agent/workspace';
import type { BrowserSnapshot } from '../../harness/browser-contract';
import { readBrowserAllowlist } from '../../preferences';
import type { Ura } from '../../ura/facade';

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
    if (!allowlist.some((entry) => matches(domain, entry))) return null;

    const root = fileRef(this.workspace());
    const ref = `${root}/sites/${domain}/${slugOf(page.url)}.md`;
    await this.ura.write(ref, render(page, domain));
    return { ref };
  }
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
