// ─── 插件来源管理（zip / 本地路径） ─────────────────────────────────
//
// 可安装清单是一份 Markdown 文件（<plugins>/registry.md），一行一条来源：
//   - [Word 文档](https://.../plugin-docx.zip#sha256=...)
//   - ./plugins/csv
// 远程只接受 zip，必须带 sha256；本地路径原地加载（不复制）。
// 已安装状态由 installed/ 与 installed.json 得出，不写回清单。
// 安装 / 卸载在下次启动时装载。

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync } from 'fflate';
import { createLogger } from '../log';

const log = createLogger('plugin-sources');
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const SUPPORTED_API_VERSION = 1;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export type PluginSourceType = 'zip' | 'local';

export interface PluginSource {
  source: string;
  type: PluginSourceType;
  /** 展示名（Markdown 链接文本 / 本地目录名 / 安装后的 manifest label）。 */
  label?: string;
  /** 已安装插件 id。 */
  name?: string;
  version?: string;
  path?: string;
  sha256?: string;
}

interface InstalledEntry {
  id: string;
  version: string;
  hash?: string;
}

type InstalledMap = Record<string, InstalledEntry>;

export interface PluginServiceOptions {
  /** 安装根（<userData>/plugins）。 */
  root: string;
  /** 可安装清单（<userData>/plugins/registry.md）。 */
  file: string;
  /** 相对路径解析基准（工作区）。 */
  cwd: () => string;
}

export class PluginService {
  private sources: PluginSource[] = [];
  private installed: InstalledMap = {};

  constructor(private readonly options: PluginServiceOptions) {}

  async start(): Promise<void> {
    await mkdir(this.options.root, { recursive: true });
    await mkdir(this.installedRoot(), { recursive: true });
    await mkdir(this.stagingRoot(), { recursive: true });
    this.installed = await this.readInstalled();
    const raw = await readFile(this.options.file, 'utf-8').catch(() => null);
    if (raw === null) {
      await this.migrateLegacy();
      return;
    }
    this.sources = parseCatalog(raw, this.options.cwd());
  }

  list(): PluginSource[] {
    return this.sources.map((entry) => {
      const installed = this.installed[entry.source];
      return {
        ...entry,
        ...(installed
          ? { name: installed.id, version: installed.version }
          : {}),
      };
    });
  }

  /** 本地来源优先，其次安装目录（installed）；内置插件由装配层追加。 */
  roots(): string[] {
    const local = this.sources
      .filter((entry) => entry.type === 'local' && entry.path)
      .map((entry) => entry.path as string);
    return [...local, this.installedRoot()];
  }

  async install(raw: string): Promise<PluginSource> {
    const source = raw.trim();
    if (!source) throw new Error('插件来源不能为空');
    const cwd = this.options.cwd();

    if (isLocalSource(source, cwd)) {
      const path = resolve(cwd, source.replace(/^~(?=\/)/, homedir()));
      const manifest = await readManifest(path);
      if (!manifest)
        throw new Error(`不是插件目录（缺少 workstudio 清单）：${path}`);
      const entry: PluginSource = {
        source,
        type: 'local',
        path,
        name: manifest.id,
        version: manifest.version,
        ...(manifest.label ? { label: manifest.label } : {}),
      };
      this.installed[source] = { id: manifest.id, version: manifest.version };
      return this.save(entry);
    }

    const zip = describeZipSource(source);
    const bytes = await download(zip.url);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (zip.sha256 && hash !== zip.sha256)
      throw new Error(`sha256 不匹配：期望 ${zip.sha256}，实际 ${hash}`);

    const staging = join(this.stagingRoot(), randomUUID());
    try {
      const manifest = await extractZip(bytes, staging);
      const target = join(this.installedRoot(), manifest.id);
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      this.installed[source] = {
        id: manifest.id,
        version: manifest.version,
        hash,
      };
      const entry: PluginSource = {
        source,
        type: 'zip',
        sha256: hash,
        name: manifest.id,
        version: manifest.version,
        ...(manifest.label ? { label: manifest.label } : {}),
      };
      return this.save(entry);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  /** 卸载：只删安装目录与安装索引；清单条目保留，可再装。 */
  async remove(source: string): Promise<boolean> {
    const entry = this.sources.find((item) => item.source === source);
    if (!entry) return false;
    const installed = this.installed[source];
    if (installed) {
      const shared = Object.entries(this.installed).some(
        ([key, value]) => key !== source && value.id === installed.id,
      );
      if (!shared) {
        await rm(join(this.installedRoot(), installed.id), {
          recursive: true,
          force: true,
        });
      }
      delete this.installed[source];
      await this.persistInstalled();
    }
    // 清单条目保留：卸载只移除安装目录，用户可再次安装。
    return true;
  }

  // ─── 内部 ───────────────────────────────────────────────

  private installedRoot(): string {
    return join(this.options.root, 'installed');
  }

  private stagingRoot(): string {
    return join(this.options.root, 'staging');
  }

  private async save(entry: PluginSource): Promise<PluginSource> {
    const existing = this.sources.findIndex(
      (item) => item.source === entry.source,
    );
    if (existing >= 0) this.sources[existing] = entry;
    else this.sources.push(entry);
    await this.persist();
    await this.persistInstalled();
    log.info('plugin source installed', entry.source);
    return entry;
  }

  /** 写回清单：保留注释与行序，只增删来源行。 */
  private async persist(): Promise<void> {
    const file = this.options.file;
    const current = await readFile(file, 'utf-8').catch(() => null);
    const lines = current === null ? ['# 可安装插件', ''] : current.split('\n');
    const keep: string[] = [];
    const present = new Set<string>();
    for (const line of lines) {
      const item = parseListLine(line);
      if (!item) {
        keep.push(line);
        continue;
      }
      if (this.sources.some((entry) => entry.source === item.source)) {
        present.add(item.source);
        keep.push(line);
      }
    }
    const additions = this.sources.filter(
      (entry) => !present.has(entry.source),
    );
    while (keep.length > 0 && keep[keep.length - 1] === '') keep.pop();
    if (additions.length > 0) {
      const last = keep[keep.length - 1] ?? '';
      if (last !== '' && !/^\s*[-*]\s/.test(last)) keep.push('');
      for (const entry of additions) keep.push(formatListLine(entry));
    }
    keep.push('');
    const tmp = `${file}.tmp`;
    await writeFile(tmp, keep.join('\n'), 'utf-8');
    await rename(tmp, file);
  }

  private installedFile(): string {
    return join(this.options.root, 'installed.json');
  }

  private async readInstalled(): Promise<InstalledMap> {
    const raw = await readFile(this.installedFile(), 'utf-8').catch(() => null);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string | InstalledEntry>;
      const normalized: InstalledMap = {};
      for (const [source, value] of Object.entries(parsed ?? {})) {
        if (typeof value === 'string') {
          normalized[source] = { id: value, version: '' };
        } else if (value && typeof value === 'object' && value.id) {
          normalized[source] = {
            id: String(value.id),
            version: String(value.version ?? ''),
            ...(value.hash ? { hash: String(value.hash) } : {}),
          };
        }
      }
      return normalized;
    } catch {
      return {};
    }
  }

  private async persistInstalled(): Promise<void> {
    const file = this.installedFile();
    const tmp = `${file}.tmp`;
    await writeFile(
      tmp,
      `${JSON.stringify(this.installed, null, 2)}\n`,
      'utf-8',
    );
    await rename(tmp, file);
  }

  /** 旧版 JSON / 旧 plugins.md → 新 registry.md。 */
  private async migrateLegacy(): Promise<void> {
    const legacyFile = join(dirname(this.options.root), 'plugins.md');
    const raw = await readFile(legacyFile, 'utf-8').catch(() => null);
    if (raw) {
      this.sources = parseCatalog(raw, this.options.cwd()).filter(
        (entry) => entry.type === 'local',
      );
      await this.persist();
      await this.persistInstalled();
      return;
    }
    await this.persist();
  }
}

// ─── 清单解析 ─────────────────────────────────────────────

function parseCatalog(markdown: string, cwd: string): PluginSource[] {
  const entries: PluginSource[] = [];
  for (const line of markdown.split('\n')) {
    const item = parseListLine(line);
    if (!item) continue;
    const parsed = describeSource(item.source, item.label, cwd);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function parseListLine(
  line: string,
): { source: string; label?: string } | null {
  const link = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$/.exec(line);
  if (link) return { label: link[1]!.trim(), source: link[2]!.trim() };
  const plain = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
  if (!plain) return null;
  const source = plain[1]!.split(/\s{2,}/)[0]!.trim();
  return source ? { source } : null;
}

function formatListLine(entry: PluginSource): string {
  if (entry.type === 'zip' && entry.label)
    return `- [${entry.label}](${entry.source})`;
  return `- ${entry.source}`;
}

function describeSource(
  source: string,
  label: string | undefined,
  cwd: string,
): PluginSource | null {
  if (isLocalSource(source, cwd)) {
    const path = resolve(cwd, source.replace(/^~(?=\/)/, homedir()));
    return {
      source,
      type: 'local',
      path,
      ...(label ? { label } : {}),
    };
  }
  try {
    const zip = describeZipSource(source);
    return {
      source,
      type: 'zip',
      sha256: zip.sha256,
      ...(label ? { label } : {}),
    };
  } catch {
    log.warn('unrecognized plugin source', source);
    return null;
  }
}

function describeZipSource(source: string): {
  url: string;
  sha256?: string;
} {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`无法识别的来源：${source}（需要 zip URL 或本地路径）`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`插件 zip 必须是 http(s) 地址：${source}`);
  if (!url.pathname.toLowerCase().endsWith('.zip'))
    throw new Error(`插件来源必须是 .zip：${source}`);
  const match = /^#sha256=([a-f0-9]{64})$/i.exec(url.hash);
  if (!match) throw new Error(`远程插件必须带 #sha256=<64位哈希>：${source}`);
  return { url: source, sha256: match[1]!.toLowerCase() };
}

function isLocalSource(source: string, cwd: string): boolean {
  if (source.startsWith('.') || source.startsWith('~') || isAbsolute(source))
    return true;
  return existsSync(resolve(cwd, source));
}

// ─── zip 安装 ─────────────────────────────────────────────

async function download(source: string): Promise<Uint8Array> {
  const response = await fetch(source, {
    headers: { 'User-Agent': 'work-studio' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_ZIP_BYTES) throw new Error('插件 zip 超过大小上限');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ZIP_BYTES)
    throw new Error('插件 zip 超过大小上限');
  return new Uint8Array(buffer);
}

interface Manifest {
  id: string;
  version: string;
  label?: string;
}

async function extractZip(
  bytes: Uint8Array,
  staging: string,
): Promise<Manifest> {
  await mkdir(staging, { recursive: true });
  const files = unzipSync(bytes);
  const names = Object.keys(files).filter((name) => !name.endsWith('/'));
  const packageFiles = names.filter(
    (name) => name === 'package.json' || name.endsWith('/package.json'),
  );
  if (packageFiles.length === 0) throw new Error('zip 中缺少 package.json');
  const depths = packageFiles.map((name) => name.split('/').length);
  const minDepth = Math.min(...depths);
  const roots = packageFiles.filter(
    (name) => name.split('/').length === minDepth,
  );
  if (roots.length !== 1)
    throw new Error('一个 zip 只能包含一个插件（多个 package.json）');
  const rootFile = roots[0]!;
  const prefix =
    rootFile === 'package.json'
      ? ''
      : rootFile.slice(0, -'package.json'.length);

  for (const name of names) {
    if (prefix && !name.startsWith(prefix)) continue;
    const relative = prefix ? name.slice(prefix.length) : name;
    const safe = normalizeZipPath(relative);
    const target = join(staging, safe);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, files[name]!);
  }

  const manifest = await readManifest(staging);
  if (!manifest) throw new Error('插件清单无效');
  return manifest;
}

function normalizeZipPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..' || part === '')
  )
    throw new Error(`zip 包含非法路径：${path}`);
  return normalized;
}

async function readManifest(root: string): Promise<Manifest | null> {
  const raw = await readFile(join(root, 'package.json'), 'utf-8').catch(
    () => null,
  );
  if (!raw) return null;
  let pkg: {
    name?: string;
    version?: string;
    exports?: string | Record<string, unknown>;
    workstudio?: {
      id?: string;
      label?: string;
      page?: string;
      settings?: string;
      apiVersion?: number;
    };
  };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }
  const ws = pkg.workstudio;
  if (!ws || typeof ws !== 'object') return null;
  const id = ws.id ?? pkg.name;
  if (!id || !ID_RE.test(id)) return null;
  if (!pkg.version) return null;
  const apiVersion = ws.apiVersion ?? SUPPORTED_API_VERSION;
  if (apiVersion > SUPPORTED_API_VERSION) return null;
  const uraEntry =
    typeof pkg.exports === 'string'
      ? pkg.exports
      : (pkg.exports?.['./ura'] as string | undefined);
  if (!uraEntry || !existsSync(join(root, uraEntry))) return null;
  for (const page of [ws.page, ws.settings]) {
    if (page && !existsSync(join(root, page))) return null;
  }
  return {
    id,
    version: String(pkg.version),
    ...(ws.label ? { label: String(ws.label) } : {}),
  };
}
