/**
 * 站点快照的资源引擎：`sites://` → 域 → 页。
 *
 * webcache 不把磁盘路径交给页面与侧车；这份适配器就是它的取数面，
 * 页面（markdown 编辑器）与助手（ls / find / read / grep）共用同一条通道。
 * 文件本身只是落盘副本，ref 身份不依赖它。
 */

import { CallFailure } from '../contract.ts';
import type { Entry, Item, ReadOptions, ResourceAdapter } from './resource.ts';
import type { SnapshotDoc, WebCache } from './web-cache.ts';
import { snapshotMarkdown } from './snapshot-doc.ts';
import type { TransportRouter } from './router.ts';

const ROOT = 'sites://';

interface Parts {
  domain: string | null;
  file: string | null;
}

function parse(ref: string): Parts | null {
  if (!ref.startsWith(ROOT)) return null;
  const rest = ref.slice(ROOT.length);
  if (!rest) return { domain: null, file: null };
  const [domain, ...tail] = rest.split('/');
  return { domain: domain || null, file: tail.join('/') || null };
}

function domainOf(doc: SnapshotDoc): string {
  try {
    return new URL(doc.url).hostname;
  } catch {
    return '';
  }
}

/** 站点快照是内建来源：在引擎层登记，页面与助手共用。 */
export function registerSitesAdapter(
  transport: TransportRouter,
  cache: WebCache,
): void {
  transport.register('sites', createSitesAdapter(cache), [
    { prefixes: ['sites://'], priority: 20 },
  ]);
}

export function createSitesAdapter(cache: WebCache): ResourceAdapter {
  const docs = (): SnapshotDoc[] => cache.list();

  const domains = (): Entry[] => {
    const counts = new Map<string, number>();
    for (const doc of docs()) {
      const domain = domainOf(doc);
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({
      name,
      type: 'dir' as const,
      ref: `${ROOT}${name}`,
      ...(count > 0 ? { size: count } : {}),
    }));
  };

  const pages = (domain: string): Entry[] =>
    docs()
      .filter((doc) => domainOf(doc) === domain)
      .map((doc) => {
        const ref = cache.refOfDoc(doc);
        return {
          name: ref.slice(`${ROOT}${domain}/`.length),
          type: 'file' as const,
          ref,
          modifiedAt: doc.capturedAt,
        };
      });

  const docOf = (ref: string): SnapshotDoc | null =>
    docs().find((doc) => cache.refOfDoc(doc) === ref) ?? null;

  const textOf = (doc: SnapshotDoc): string => snapshotMarkdown(doc);

  return {
    describe: () => ({
      root: ROOT,
      label: '网站快照',
      summary: '采集过的站点：域 → 页；ls 浏览结构，read / grep 读正文',
    }),

    async ls(ref: string): Promise<Entry[]> {
      const parts = parse(ref);
      if (!parts || parts.file) return [];
      return parts.domain ? pages(parts.domain) : domains();
    },

    async find(ref: string, query: string): Promise<Entry[]> {
      const parts = parse(ref);
      if (!parts || parts.file) return [];
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const entries = parts.domain ? pages(parts.domain) : domains();
      return entries.filter((entry) =>
        entry.name.toLowerCase().includes(needle),
      );
    },

    async read(ref: string, _options?: ReadOptions): Promise<Item[]> {
      const doc = docOf(ref);
      if (!doc) throw new CallFailure('not_found', `没有这条快照：${ref}`);
      return [
        {
          locator: doc.url,
          title: doc.title,
          ref,
          text: textOf(doc),
        },
      ];
    },

    async grep(ref: string, query: string): Promise<Item[]> {
      const parts = parse(ref);
      if (!parts) return [];
      const needle = query.trim();
      if (!needle) return [];
      const scope = parts.file
        ? [docOf(ref)].filter((doc): doc is SnapshotDoc => doc !== null)
        : docs().filter(
            (doc) => !parts.domain || domainOf(doc) === parts.domain,
          );
      const items: Item[] = [];
      for (const doc of scope) {
        const text = textOf(doc);
        const index = text.indexOf(needle);
        if (index < 0) continue;
        const line = text.slice(0, index).split('\n').length;
        items.push({
          locator: `${doc.url}#L${line}`,
          title: doc.title,
          ref: cache.refOfDoc(doc),
          line,
          snippet: text.slice(index, index + 200),
        });
        if (items.length >= 50) break;
      }
      return items;
    },
  };
}
