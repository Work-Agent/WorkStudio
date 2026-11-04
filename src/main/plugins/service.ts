// ─── 插件来源管理（zip / 本地路径） ─────────────────────────────────
//
// 可安装清单随源码维护（PLUGINS.md），构建期解析成静态数组
// （virtual:plugin-registry）：运行期只读数据，不读、不写 Markdown。
// 远程只接受 zip，必须带 sha256；本地 zip 路径同一套解压流程；
// 本地目录原地加载（不复制）。下载读 https_proxy 环境变量走代理。
// 安装状态由 installed/ 与 installed.json 得出；临时来源只记安装状态。

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync } from 'fflate';
import { fetch as undiciFetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import { PLUGIN_REGISTRY } from 'virtual:plugin-registry';
import {
  describePluginSource,
  type PluginRegistryEntry,
  type PluginSource,
  type PluginSourceType,
} from '../../shared/plugin-registry';
import { createLogger } from '../log';

const log = createLogger('plugin-sources');
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const SUPPORTED_API_VERSION = 1;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

interface InstalledEntry {
  id: string;
  version: string;
  hash?: string;
  type?: PluginSourceType;
  label?: string;
  path?: string;
  sha256?: string;
}

type InstalledMap = Record<string, InstalledEntry>;

export interface PluginServiceOptions {
  /** 安装根（<userData>/plugins）。 */
  root: string;
  /** 相对路径解析基准（工作区）。 */
  cwd: () => string;
}

export class PluginService {
  private installed: InstalledMap = {};

  constructor(private readonly options: PluginServiceOptions) {}

  async start(): Promise<void> {
    await mkdir(this.options.root, { recursive: true });
    await mkdir(this.installedRoot(), { recursive: true });
    // 解压沙盒：目录常驻、内容瞬态——启动清空，覆盖安装中断留下的残留
    await rm(this.stagingRoot(), { recursive: true, force: true });
    await mkdir(this.stagingRoot(), { recursive: true });
    this.installed = await this.readInstalled();
  }

  /** 清单条目 + 本机临时安装的来源；安装状态取自 installed.json。 */
  list(): PluginSource[] {
    const entries = new Map<string, PluginSource>();
    for (const declared of PLUGIN_REGISTRY)
      entries.set(declared.source, this.resolve(declared));
    for (const [source, installed] of Object.entries(this.installed)) {
      const entry = entries.get(source);
      if (entry) {
        entry.name = installed.id;
        entry.version = installed.version;
        if (!entry.label && installed.label) entry.label = installed.label;
        continue;
      }
      const extra = this.sourceOf(source, installed);
      if (extra) entries.set(source, extra);
    }
    return [...entries.values()];
  }

  /** 本地来源优先，其次安装目录（installed）；内置插件由装配层追加。 */
  roots(): string[] {
    const local = this.list()
      .filter((entry) => entry.type === 'local' && entry.path)
      .map((entry) => entry.path as string);
    return [...local, this.installedRoot()];
  }

  /** 来源对应的插件 id（仅本机安装记录；未安装返回 null）。 */
  installedIdOf(source: string): string | null {
    return this.installed[source]?.id ?? null;
  }

  /** 该 id 是否还被其他来源安装（卸载时决定是否删目录 / 撤运行时）。 */
  isSharedId(id: string, exceptSource: string): boolean {
    return Object.entries(this.installed).some(
      ([key, value]) => key !== exceptSource && value.id === id,
    );
  }

  /** 来源对应的插件目录（本地目录原地；zip 安装在 installed/<id>）。 */
  installRootOf(source: string): string | null {
    const installed = this.installed[source];
    if (!installed) return null;
    return installed.path ?? join(this.installedRoot(), installed.id);
  }

  async install(raw: string): Promise<PluginSource> {
    const source = raw.trim();
    if (!source) throw new Error('插件来源不能为空');
    const declared = PLUGIN_REGISTRY.find((entry) => entry.source === source);
    const entry = this.resolve(declared ?? describePluginSource(source));

    if (entry.type === 'local') {
      const path = entry.path ?? resolve(this.options.cwd(), source);
      if (/\.zip$/i.test(path)) {
        // 本地 zip：与远程同一套解压安装流程，只是字节来自磁盘
        return this.installZipBytes(await readLocalZip(path), source, entry);
      }
      const manifest = await readManifest(path);
      if (!manifest)
        throw new Error(`不是插件目录（缺少 workstudio 清单）：${path}`);
      const label = entry.label ?? manifest.label;
      this.installed[source] = {
        id: manifest.id,
        version: manifest.version,
        type: 'local',
        path,
        ...(label ? { label } : {}),
      };
      await this.persistInstalled();
      log.info('plugin source installed', source);
      return {
        source,
        type: 'local',
        path,
        name: manifest.id,
        version: manifest.version,
        ...(label ? { label } : {}),
      };
    }

    const bytes = await download(source);
    return this.installZipBytes(bytes, source, entry);
  }

  /** 卸载：只删安装目录与安装索引；清单条目保留，可再装。 */
  async remove(source: string): Promise<boolean> {
    const declared = PLUGIN_REGISTRY.some((entry) => entry.source === source);
    const installed = this.installed[source];
    if (!installed) return declared;
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
    return true;
  }

  // ─── 内部 ───────────────────────────────────────────────

  /** zip 安装公共流程：校验哈希 → 解压到 staging → 原子落位 → 记索引。 */
  private async installZipBytes(
    bytes: Uint8Array,
    source: string,
    entry: PluginRegistryEntry,
  ): Promise<PluginSource> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (entry.sha256 && hash !== entry.sha256)
      throw new Error(`sha256 不匹配：期望 ${entry.sha256}，实际 ${hash}`);

    const staging = join(this.stagingRoot(), randomUUID());
    try {
      const manifest = await extractZip(bytes, staging);
      const target = join(this.installedRoot(), manifest.id);
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      const label = entry.label ?? manifest.label;
      const sha256 = entry.sha256 ?? hash;
      this.installed[source] = {
        id: manifest.id,
        version: manifest.version,
        hash,
        type: 'zip',
        sha256,
        ...(label ? { label } : {}),
      };
      await this.persistInstalled();
      log.info('plugin source installed', source);
      return {
        source,
        type: 'zip',
        sha256,
        name: manifest.id,
        version: manifest.version,
        ...(label ? { label } : {}),
      };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private resolve(entry: PluginRegistryEntry): PluginSource {
    if (entry.type === 'zip') return { ...entry };
    return {
      ...entry,
      path: resolve(
        this.options.cwd(),
        entry.source.replace(/^~(?=\/)/, homedir()),
      ),
    };
  }

  /** 不在清单里的本机安装来源：优先用安装时记录的描述。 */
  private sourceOf(
    source: string,
    installed: InstalledEntry,
  ): PluginSource | null {
    if (installed.type === 'local' && installed.path)
      return {
        source,
        type: 'local',
        path: installed.path,
        ...(installed.label ? { label: installed.label } : {}),
        name: installed.id,
        version: installed.version,
      };
    if (installed.type === 'zip')
      return {
        source,
        type: 'zip',
        ...(installed.label ? { label: installed.label } : {}),
        ...(installed.sha256 ? { sha256: installed.sha256 } : {}),
        name: installed.id,
        version: installed.version,
      };
    // 旧记录只有 id / version：按来源形态补全。
    try {
      return {
        ...this.resolve(describePluginSource(source)),
        name: installed.id,
        version: installed.version,
      };
    } catch {
      return null;
    }
  }

  private installedRoot(): string {
    return join(this.options.root, 'installed');
  }

  private stagingRoot(): string {
    return join(this.options.root, 'staging');
  }

  private installedFile(): string {
    return join(this.options.root, 'installed.json');
  }

  private async readInstalled(): Promise<InstalledMap> {
    const raw = await readFile(this.installedFile(), 'utf-8').catch(() => null);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<
        string,
        string | Partial<InstalledEntry>
      >;
      const normalized: InstalledMap = {};
      for (const [source, value] of Object.entries(parsed ?? {})) {
        if (typeof value === 'string') {
          normalized[source] = { id: value, version: '' };
          continue;
        }
        if (!value || typeof value !== 'object' || !value.id) continue;
        const type =
          value.type === 'zip' || value.type === 'local'
            ? value.type
            : undefined;
        normalized[source] = {
          id: String(value.id),
          version: String(value.version ?? ''),
          ...(value.hash ? { hash: String(value.hash) } : {}),
          ...(type ? { type } : {}),
          ...(value.label ? { label: String(value.label) } : {}),
          ...(value.path ? { path: String(value.path) } : {}),
          ...(value.sha256 ? { sha256: String(value.sha256) } : {}),
        };
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
}

// ─── zip 安装 ─────────────────────────────────────────────

let proxyApplied = false;

/** 终端导出的 https_proxy / http_proxy（仅 HTTP 代理；socks 端口通常同服，改写协议即可用）。 */
function applyProxy(): void {
  if (proxyApplied) return;
  proxyApplied = true;
  const raw = (
    process.env.https_proxy ??
    process.env.HTTPS_PROXY ??
    process.env.http_proxy ??
    process.env.HTTP_PROXY ??
    ''
  )
    .trim()
    .replace(/^socks\d+:\/\//, 'http://');
  if (!raw) return;
  try {
    // H2 经代理易断流，锁定 HTTP/1.1；npm undici 的全局调度器不影响 Node 内建 fetch
    setGlobalDispatcher(new ProxyAgent({ uri: raw, allowH2: false }));
    log.info('plugin download via proxy', raw);
  } catch (error) {
    log.warn('invalid proxy url, direct fetch', error);
  }
}

/** 统一下载：单次 5 分钟超时（大包慢网）、64MB 上限、代理链路瞬断重试一次。 */
async function fetchBytes(
  url: string,
  headers: Record<string, string>,
): Promise<Uint8Array> {
  applyProxy();
  const fetchOnce = async (): Promise<Uint8Array> => {
    const response = await undiciFetch(url, {
      headers,
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_ZIP_BYTES) throw new Error('插件 zip 超过大小上限');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ZIP_BYTES)
      throw new Error('插件 zip 超过大小上限');
    return new Uint8Array(buffer);
  };
  try {
    return await fetchOnce();
  } catch (error) {
    log.warn(
      'download interrupted, retry once',
      url,
      error instanceof Error ? error.message : error,
    );
    return await fetchOnce();
  }
}

/** zip 远程下载：统一走 fetchBytes（代理 / 重试 / 超时 / 上限）。 */
async function download(source: string): Promise<Uint8Array> {
  return fetchBytes(source, { 'User-Agent': 'work-studio' });
}

async function readLocalZip(path: string): Promise<Uint8Array> {
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) throw new Error(`无法读取 zip 文件：${path}`);
  if (bytes.byteLength > MAX_ZIP_BYTES)
    throw new Error('插件 zip 超过大小上限');
  return new Uint8Array(bytes);
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
