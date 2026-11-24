/**
 * 插件社区目录：Markdown 固定格式。
 *
 * 成功时写缓存；失败回退缓存并标记 stale。目录只描述来源，
 * 不执行插件代码。
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLog } from '../log.ts';
import type { StorageLayout } from '../platform/paths.ts';

const log = createLog('plugin-catalog');

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/SimbaLink/WorkStudio-Plugins/main/PLUGINS.md';

const REQUIRED = ['id', 'name', 'source'] as const;
const SOURCE_RE = /^https?:\/\//i;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  source: string;
  icon?: string;
  tags: string[];
  category: string;
}

export interface CatalogResult {
  entries: CatalogEntry[];
  url: string;
  fetchedAt: number | null;
  stale: boolean;
  error?: string;
}

export class PluginCatalogService {
  private url = DEFAULT_CATALOG_URL;
  private last: CatalogResult | null = null;

  constructor(private readonly layout: StorageLayout) {}

  async start(): Promise<void> {
    const stored = await readFile(this.urlFile(), 'utf-8').catch(() => null);
    if (stored?.trim()) this.url = stored.trim();
  }

  currentUrl(): string {
    return this.url;
  }

  current(): CatalogResult | null {
    return this.last;
  }

  async load(url?: string): Promise<CatalogResult> {
    const target = url?.trim() || this.url;
    if (url?.trim()) {
      this.url = url.trim();
      await writeFile(this.urlFile(), `${this.url}\n`, 'utf-8').catch(
        () => undefined,
      );
    }
    try {
      const response = await fetch(target, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'text/markdown',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const markdown = await response.text();
      const entries = parseCatalogMarkdown(markdown);
      await this.writeCache(markdown);
      this.last = { entries, url: target, fetchedAt: Date.now(), stale: false };
      return this.last;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`目录拉取失败：${target} ${message}`);
      const cached = await readFile(this.cacheFile(), 'utf-8').catch(
        () => null,
      );
      this.last = {
        entries: cached ? parseCatalogMarkdown(cached) : [],
        url: target,
        fetchedAt: null,
        stale: true,
        error: message,
      };
      return this.last;
    }
  }

  private async writeCache(markdown: string): Promise<void> {
    const file = this.cacheFile();
    const temp = `${file}.tmp`;
    await writeFile(temp, markdown, 'utf-8');
    await rename(temp, file);
  }

  private cacheFile(): string {
    return join(this.layout.pluginsRoot, 'catalog.md');
  }

  private urlFile(): string {
    return join(this.layout.pluginsRoot, 'catalog-url.txt');
  }
}

/** 解析 Markdown：标题 → 分类，表格 → 条目。 */
export function parseCatalogMarkdown(markdown: string): CatalogEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: CatalogEntry[] = [];
  const seen = new Set<string>();
  let category = '';
  let inFence = false;
  let header: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      header = null;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      category = heading[2]!.trim();
      header = null;
      continue;
    }
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    if (!header) {
      header = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    if (!REQUIRED.every((key) => row[key])) continue;
    if (!ID_RE.test(row.id) || !SOURCE_RE.test(row.source)) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    entries.push({
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      source: row.source,
      ...(row.icon ? { icon: row.icon } : {}),
      tags: (row.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      category: category || '其他',
    });
  }
  return entries;
}
