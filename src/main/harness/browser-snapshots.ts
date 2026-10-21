// ─── 网站快照（白名单域归档） ────────────────────────────────────────
//
// 只有白名单域（含子域）的页面才落盘；快照是可读的 Markdown，
// 既给页面渲染，也给 AI 上下文（经 URA read 的文本投影）。

import { createHash } from 'node:crypto'
import type { BrowserSnapshot } from './browser-contract'
import type { PluginHost } from '../plugins/host'
import type { Ura } from '../ura/facade'

const PLUGIN_ID = 'settings-browser'
const ALLOWLIST_KEY = 'allowlist'

export class SiteSnapshots {
  constructor(
    private readonly ura: Ura,
    private readonly host: PluginHost,
    private readonly workspace: () => string,
  ) {}

  /** 白名单域才归档；返回快照资源 id。 */
  async capture(page: BrowserSnapshot): Promise<{ ref: string } | null> {
    const domain = domainOf(page.url)
    if (!domain) return null
    const allowlist = await this.host.getSetting<string[]>(
      PLUGIN_ID,
      ALLOWLIST_KEY,
      [],
    )
    if (!allowlist.some((entry) => matches(domain, entry))) return null

    const root = `file://${this.workspace().replace(/\/$/, '')}`
    const ref = `${root}/sites/${domain}/${slugOf(page.url)}.md`
    await this.ura.write(ref, render(page, domain))
    return { ref }
  }
}

function domainOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

function matches(domain: string, entry: string): boolean {
  const normalized = entry.trim().toLowerCase().replace(/^\./, '')
  if (!normalized) return false
  return domain === normalized || domain.endsWith(`.${normalized}`)
}

function slugOf(url: string): string {
  const parsed = new URL(url)
  const path = parsed.pathname
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 8)
  return `${path || 'index'}-${hash}`
}

function render(page: BrowserSnapshot, domain: string): string {
  const frontmatter = [
    '---',
    `url: ${page.url}`,
    `title: ${page.title.replace(/\n/g, ' ')}`,
    `domain: ${domain}`,
    `capturedAt: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n')
  return frontmatter + page.markdown + '\n'
}
