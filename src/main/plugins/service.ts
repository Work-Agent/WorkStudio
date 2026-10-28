// ─── 插件来源管理（zip / 本地路径） ─────────────────────────────────
//
// 可安装清单随源码维护（PLUGINS.md），构建期解析成静态数组
// （virtual:plugin-registry）：运行期只读数据，不读、不写 Markdown。
// 远程只接受 zip，必须带 sha256；本地路径原地加载（不复制）。
// 安装状态由 installed/ 与 installed.json 得出；临时来源只记安装状态。

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync } from 'fflate';
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

  async install(raw: string): Promise<PluginSource> {
    const source = raw.trim();
    if (!source) throw new Error('插件来源不能为空');
    const declared = PLUGIN_REGISTRY.find((entry) => entry.source === source);
    const entry = this.resolve(declared ?? describePluginSource(source));

    if (entry.type === 'local') {
      const path = entry.path ?? resolve(this.options.cwd(), source);
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
