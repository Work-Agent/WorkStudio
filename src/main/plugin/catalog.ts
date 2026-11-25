/**
 * 插件目录：拉取独立注册表生成的 index.json。
 *
 * 应用只读 index；启动时只加载缓存，打开设置页或显式刷新时才联网。
 * 失败保留缓存并标记 stale，不阻塞已安装插件。
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLog } from '../log.ts';
import { isReservedPluginId } from './manifest.ts';
import type { StorageLayout } from '../platform/paths.ts';

const log = createLog('plugin-catalog');

export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/Work-Agent/PluginRegistry/main/index.json';

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT = 15_000;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  sha256: string;
  repo?: string;
  icon?: string;
  category?: string;
  tags: string[];
  deprecated?: boolean;
}

export interface CatalogResult {
  entries: CatalogEntry[];
  url: string;
  fetchedAt: number | null;
  stale: boolean;
  error?: string;
  warnings?: string[];
}

interface CatalogMeta {
  url: string;
  fetchedAt: number | null;
  etag: string | null;
  lastModified: string | null;
}

export class PluginCatalogService {
  private url =
    process.env['WS_PLUGIN_CATALOG_URL']?.trim() || DEFAULT_CATALOG_URL;
  private last: CatalogResult = {
    entries: [],
    url: this.url,
    fetchedAt: null,
    stale: false,
  };

  constructor(private readonly layout: StorageLayout) {}

  /** 只读缓存，不联网。 */
  async start(): Promise<void> {
    const meta = await this.readMeta();
    const target = process.env['WS_PLUGIN_CATALOG_URL']?.trim() || meta?.url;
    if (target) this.url = target;
    if (!meta || meta.url !== this.url || meta.fetchedAt === null) {
      this.last = {
        entries: [],
        url: this.url,
        fetchedAt: null,
        stale: false,
      };
      return;
    }
    const cached = await readFile(this.cacheFile(), 'utf-8').catch(() => null);
    const parsed = cached ? parseIndex(cached) : null;
    this.last = {
      entries: parsed?.entries ?? [],
      url: this.url,
      fetchedAt: meta.fetchedAt,
      stale: false,
      ...(parsed?.warnings.length ? { warnings: parsed.warnings } : {}),
    };
  }

  current(): CatalogResult {
    return this.last;
  }

  entry(id: string): CatalogEntry | null {
    return this.last.entries.find((item) => item.id === id) ?? null;
  }

  async setUrl(value: string): Promise<void> {
    const target = value.trim();
    if (!target) {
      await this.resetUrl();
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error(`目录地址非法：${target}`);
    }
    if (!isAllowedUrl(parsed, false)) {
      throw new Error('目录地址必须是 https（本地开发允许回环 http）');
    }
    this.url = target;
    this.last = {
      ...this.last,
      url: target,
      fetchedAt: null,
      stale: false,
      entries: [],
    };
    await this.clearCache();
    await this.writeMeta(null);
  }

  async resetUrl(): Promise<void> {
    this.url = DEFAULT_CATALOG_URL;
    this.last = {
      entries: [],
      url: this.url,
      fetchedAt: null,
      stale: false,
    };
    await this.clearCache();
    await this.writeMeta(null);
  }

  /** 拉取 index.json；失败时保留上一份并标记 stale。 */
  async load(url?: string): Promise<CatalogResult> {
    if (url !== undefined) await this.setUrl(url);
    const target = this.url;
    const previous = this.last;
    const meta = await this.readMeta();
    const headers: Record<string, string> = {
      'User-Agent': 'work-studio',
      Accept: 'application/json',
    };
    if (meta && meta.url === target) {
      if (meta.etag) headers['If-None-Match'] = meta.etag;
      if (meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
    }

    try {
      const response = await fetch(target, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        redirect: 'follow',
      });
      if (response.status === 304) {
        this.last = {
          ...previous,
          url: target,
          fetchedAt: Date.now(),
          stale: false,
        };
        await this.writeMeta({
          etag: response.headers.get('etag') ?? meta?.etag ?? null,
          lastModified:
            response.headers.get('last-modified') ?? meta?.lastModified ?? null,
        });
        return this.last;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_INDEX_BYTES) throw new Error('目录文件超过 2MB');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_INDEX_BYTES) {
        throw new Error('目录文件超过 2MB');
      }
      const parsed = parseIndex(new TextDecoder().decode(bytes));
      await this.writeCache(new TextDecoder().decode(bytes));
      await this.writeMeta({
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      });
      this.last = {
        entries: parsed.entries,
        url: target,
        fetchedAt: Date.now(),
        stale: false,
        ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
      };
      return this.last;
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw === 'fetch failed' ? '网络请求失败' : raw;
      log.warn(`目录拉取失败：${target} ${raw}`);
      this.last = {
        ...previous,
        url: target,
        stale: true,
        error: message,
      };
      return this.last;
    }
  }

  private cacheFile(): string {
    return join(this.layout.pluginsCatalogRoot, 'index.json');
  }

  private metaFile(): string {
    return join(this.layout.pluginsCatalogRoot, 'meta.json');
  }

  private async readMeta(): Promise<CatalogMeta | null> {
    const text = await readFile(this.metaFile(), 'utf-8').catch(() => null);
    if (!text) return null;
    try {
      const value = JSON.parse(text) as Partial<CatalogMeta>;
      if (typeof value.url !== 'string') return null;
      return {
        url: value.url,
        fetchedAt: typeof value.fetchedAt === 'number' ? value.fetchedAt : null,
        etag: typeof value.etag === 'string' ? value.etag : null,
        lastModified:
          typeof value.lastModified === 'string' ? value.lastModified : null,
      };
    } catch {
      return null;
    }
  }

  private async writeMeta(
    next: { etag: string | null; lastModified: string | null } | null,
  ): Promise<void> {
    const meta: CatalogMeta = {
      url: this.url,
      fetchedAt: next ? Date.now() : null,
      etag: next?.etag ?? null,
      lastModified: next?.lastModified ?? null,
    };
    await writeAtomic(this.metaFile(), `${JSON.stringify(meta, null, 2)}\n`);
  }

  private async writeCache(text: string): Promise<void> {
    await writeAtomic(this.cacheFile(), text);
  }

  private async clearCache(): Promise<void> {
    await rm(this.cacheFile(), { force: true });
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, text, 'utf-8');
  await rename(temp, file);
}

interface ParsedIndex {
  entries: CatalogEntry[];
  warnings: string[];
}

/** 解析并校验 index.json；0 条有效条目视为失败。 */
export function parseIndex(text: string): ParsedIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('目录不是合法 JSON');
  }
  if (!isRecord(raw)) throw new Error('目录格式错误');
  if (raw['schemaVersion'] !== 1) {
    throw new Error(`不支持的目录版本：${String(raw['schemaVersion'])}`);
  }
  const list = raw['entries'];
  if (!Array.isArray(list)) throw new Error('目录缺少 entries');
  const entries: CatalogEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [index, value] of list.entries()) {
    const result = normalizeEntry(value);
    if (typeof result === 'string') {
      warnings.push(`条目 ${index}: ${result}`);
      continue;
    }
    if (seen.has(result.id)) {
      warnings.push(`条目 ${index}: id 重复：${result.id}`);
      continue;
    }
    seen.add(result.id);
    entries.push(result);
  }
  if (entries.length === 0 && list.length > 0) {
    throw new Error('目录没有有效条目');
  }
  return { entries, warnings };
}

function normalizeEntry(value: unknown): CatalogEntry | string {
  if (!isRecord(value)) return '不是对象';
  const id = value['id'];
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'id 非法';
  if (isReservedPluginId(id)) return 'id 保留';
  const name = value['name'];
  if (typeof name !== 'string' || !name.trim()) return 'name 缺失';
  const description = value['description'];
  if (typeof description !== 'string') return 'description 缺失';
  const version = value['version'];
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    return 'version 非法';
  }
  const source = value['source'];
  if (typeof source !== 'string' || !isAllowedUrl(source, true)) {
    return 'source 必须是 https zip（本地开发允许回环 http）';
  }
  const sha256 = value['sha256'];
  if (typeof sha256 !== 'string' || !SHA_RE.test(sha256)) {
    return 'sha256 非法';
  }
  const repo = value['repo'];
  if (repo !== undefined && (typeof repo !== 'string' || !isHttps(repo))) {
    return 'repo 非法';
  }
  const icon = value['icon'];
  if (icon !== undefined && typeof icon !== 'string') return 'icon 非法';
  const category = value['category'];
  if (category !== undefined && typeof category !== 'string') {
    return 'category 非法';
  }
  const tagsValue = value['tags'];
  if (
    tagsValue !== undefined &&
    (!Array.isArray(tagsValue) ||
      tagsValue.some((tag) => typeof tag !== 'string'))
  ) {
    return 'tags 非法';
  }
  const deprecated = value['deprecated'];
  if (deprecated !== undefined && typeof deprecated !== 'boolean') {
    return 'deprecated 非法';
  }
  return {
    id,
    name,
    description,
    version,
    source,
    sha256,
    ...(typeof repo === 'string' ? { repo } : {}),
    ...(typeof icon === 'string' ? { icon } : {}),
    ...(typeof category === 'string' ? { category } : {}),
    tags: Array.isArray(tagsValue)
      ? tagsValue.filter((tag): tag is string => typeof tag === 'string')
      : [],
    ...(deprecated ? { deprecated: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 目录地址与插件包只接受 https；本地回环允许 http 便于开发与测试。 */
function isAllowedUrl(value: string | URL, requireZip: boolean): boolean {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return false;
  }
  if (requireZip && !url.pathname.toLowerCase().endsWith('.zip')) {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopback(url.hostname);
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/** 简单 semver 比较：负数 / 0 / 正数。 */
export function compareVersions(a: string, b: string): number {
  const [aMain = '', aPre] = a.split('-', 2);
  const [bMain = '', bPre] = b.split('-', 2);
  const aParts = aMain.split('.').map((part) => Number(part) || 0);
  const bParts = bMain.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}
