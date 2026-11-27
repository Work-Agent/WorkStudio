/**
 * 站点发现：sitemap（robots.txt + /sitemap.xml）与页面链接合并成一棵页树。
 *
 * 只做发现与去重，不做抓取；抓取由浏览器能力逐页完成。
 * 结果顺序：种子页 → sitemap → 页面内链接，截断到 max。
 */

const MAX_LOCS = 2000;
const SKIP_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|mp4|mp3|woff2?|ttf)$/i;

export type Fetcher = (url: string) => Promise<Response>;

export function normalizePageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function textOf(url: string, fetcher: Fetcher): Promise<string> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

/** robots.txt 的 Sitemap 行；缺省再试 /sitemap.xml。 */
async function sitemapRoots(
  origin: string,
  fetcher: Fetcher,
): Promise<string[]> {
  const roots = new Set<string>();
  const robots = await textOf(`${origin}/robots.txt`, fetcher);
  for (const line of robots.split('\n')) {
    const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (match?.[1]) roots.add(match[1].trim());
  }
  if (roots.size === 0) roots.add(`${origin}/sitemap.xml`);
  return [...roots];
}

/** sitemap / sitemapindex：索引最多再展开一层。 */
async function locsOf(
  url: string,
  fetcher: Fetcher,
  depth: number,
): Promise<string[]> {
  const xml = await textOf(url, fetcher);
  if (!xml) return [];
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .slice(0, MAX_LOCS);
  if (/<sitemapindex[\s>]/i.test(xml) && depth > 0) {
    const nested: string[] = [];
    for (const child of locs.slice(0, 20)) {
      nested.push(...(await locsOf(child, fetcher, depth - 1)));
    }
    return nested;
  }
  return locs;
}

/** 页面内可导航的链接：<a href> 与 [role=link]，按文档顺序去重。 */
export function linksOf(html: string, base: string): string[] {
  const out: string[] = [];
  const pattern = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1] ?? '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
      continue;
    }
    try {
      const url = new URL(href, base);
      if (!/^https?:$/.test(url.protocol)) continue;
      out.push(url.toString());
    } catch {
      /* 坏链接跳过 */
    }
  }
  return out;
}

export async function discoverPages(
  seed: string,
  max: number,
  fetcher: Fetcher = (url) => fetch(url),
): Promise<string[]> {
  const start = normalizePageUrl(seed);
  if (!start) return [];
  const origin = new URL(start).origin;
  const limit = Math.max(1, Math.min(max, 200));
  const ordered: string[] = [start];
  const seen = new Set<string>([start]);

  const add = (value: string): void => {
    if (ordered.length >= limit) return;
    const url = normalizePageUrl(value);
    if (!url || seen.has(url)) return;
    if (new URL(url).origin !== origin) return;
    if (SKIP_EXT.test(new URL(url).pathname)) return;
    seen.add(url);
    ordered.push(url);
  };

  for (const root of await sitemapRoots(origin, fetcher)) {
    for (const loc of await locsOf(root, fetcher, 1)) {
      add(loc);
      if (ordered.length >= limit) return ordered;
    }
  }

  // 种子页的链接补齐 sitemap 之外的新页面（例如列表页、分页）。
  const html = await textOf(start, fetcher);
  for (const href of linksOf(html, start)) {
    add(href);
    if (ordered.length >= limit) break;
  }
  return ordered;
}
