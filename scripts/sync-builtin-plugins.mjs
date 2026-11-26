/**
 * 打包期同步注册表中标记 builtin 的插件。
 *
 * 输入是 PluginRegistry 生成的 index.json；只挑选 builtin: true 的条目，按
 * source 下载 zip、校验 sha256、解包到 out/plugins/<id>。运行时 seedBuiltins
 * 再把这些包播种到数据根的 plugins/installed，安装包因此自带一份已安装副本。
 *
 * 这个脚本只在打包时运行（pnpm package / make / release 与 release workflow），
 * 不参与 pnpm build / verify，避免日常构建依赖网络。
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { ProxyAgent, Socks5ProxyAgent, fetch } from 'undici';

const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/Work-Agent/PluginRegistry/main/index.json';
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_FILES = 20_000;
const FETCH_TIMEOUT = 300_000;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA_RE = /^[a-f0-9]{64}$/;

const args = process.argv.slice(2);
const outDir = resolve(option('--out') ?? 'out/plugins');
const registrySource =
  option('--registry') ??
  process.env['WS_PLUGIN_REGISTRY_URL'] ??
  DEFAULT_REGISTRY;

const dispatcher = createDispatcher();

try {
  await syncBuiltinPlugins();
} catch (error) {
  console.error(
    `[builtin] 同步失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function syncBuiltinPlugins() {
  const registry = await readRegistry(registrySource);
  const entries = registry.entries
    .filter((entry) => entry?.builtin === true)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (entries.length === 0) {
    console.log('[builtin] 注册表没有 builtin 条目');
    return;
  }

  const seen = new Set();
  for (const entry of entries) {
    validateEntry(entry);
    if (seen.has(entry.id)) throw new Error(`builtin id 重复：${entry.id}`);
    seen.add(entry.id);

    const bytes = await download(entry.source);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) {
      throw new Error(
        `${entry.id}: sha256 不匹配（期望 ${entry.sha256}，实际 ${digest}）`,
      );
    }
    installPackage(entry, bytes);
    console.log(`[builtin] ${entry.id}@${entry.version} ← ${entry.source}`);
  }
  console.log(`[builtin] 已同步 ${entries.length} 个插件到 ${outDir}`);
}

async function readRegistry(source) {
  const text = /^https?:\/\//i.test(source)
    ? await fetchText(source, MAX_INDEX_BYTES)
    : readFileSync(resolve(source), 'utf-8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('注册表不是合法 JSON');
  }
  if (value?.schemaVersion !== 1)
    throw new Error('注册表 schemaVersion 必须是 1');
  if (!Array.isArray(value.entries)) throw new Error('注册表缺少 entries');
  return value;
}

async function fetchText(url, maxBytes) {
  const response = await request(url, 'application/vnd.github.raw');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > maxBytes) throw new Error(`${url}: 响应超过 ${maxBytes} 字节`);
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error(`${url}: 响应超过 ${maxBytes} 字节`);
  }
  return text;
}

async function download(url) {
  const response = await request(url, 'application/zip');
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_ZIP_BYTES) throw new Error(`${url}: zip 超过 64MB`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`${url}: zip 超过 64MB`);
  }
  return bytes;
}

async function request(url, accept) {
  const init = {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      'User-Agent': 'work-studio',
      Accept: accept,
    },
  };
  if (dispatcher && !isLoopback(url)) init.dispatcher = dispatcher;
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

function installPackage(entry, bytes) {
  const target = join(outDir, entry.id);
  const temporary = join(outDir, `.incoming-${entry.id}-${process.pid}`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: true });
  try {
    extractZip(bytes, temporary);
    const root = findPackageRoot(temporary);
    if (!root) throw new Error(`${entry.id}: zip 中缺少 package.json`);
    const pkg = readPackage(root);
    if (pkg.version !== entry.version) {
      throw new Error(
        `${entry.id}: 包版本 ${pkg.version} 与注册表 ${entry.version} 不一致`,
      );
    }
    if (pkg.id !== entry.id) {
      throw new Error(`${entry.id}: 包 manifest id 是 ${pkg.id}`);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(root, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function extractZip(bytes, root) {
  let rejected = null;
  let count = 0;
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      count += 1;
      if (count > MAX_ZIP_FILES) {
        rejected ??= '文件数量过多';
        return false;
      }
      const normalized = normalize(file.name);
      if (!normalized) {
        rejected ??= '包含空路径';
        return false;
      }
      if (normalized.endsWith('/')) return false;
      if (isUnsafePath(normalized)) {
        rejected ??= `包含非法路径：${file.name}`;
        return false;
      }
      if (total + file.originalSize > MAX_UNPACKED_BYTES) {
        rejected ??= '解压后超过 256MB';
        return false;
      }
      total += file.originalSize;
      return true;
    },
  });
  if (rejected) throw new Error(`插件包${rejected}`);
  for (const [name, data] of Object.entries(files)) {
    const normalized = normalize(name);
    if (!normalized || normalized.endsWith('/')) continue;
    const file = join(root, normalized);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
}

function readPackage(root) {
  let value;
  try {
    value = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  } catch {
    throw new Error('package.json 无法解析');
  }
  const manifest = value?.workstudio ?? value?.workStudio;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('缺少 workstudio 清单');
  }
  if (typeof value.version !== 'string' || !VERSION_RE.test(value.version)) {
    throw new Error('package.json version 非法');
  }
  return { id: manifest.id, version: value.version };
}

function findPackageRoot(root) {
  if (existsFile(join(root, 'package.json'))) return root;
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (!statSync(child).isDirectory()) continue;
    const found = findPackageRoot(child);
    if (found) return found;
  }
  return null;
}

function existsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function normalize(name) {
  return name.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isUnsafePath(name) {
  return (
    name.startsWith('/') || name.includes(':') || name.split('/').includes('..')
  );
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('builtin 条目必须是对象');
  }
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) {
    throw new Error(`builtin id 非法：${String(entry.id)}`);
  }
  if (typeof entry.version !== 'string' || !VERSION_RE.test(entry.version)) {
    throw new Error(`${entry.id}: version 非法`);
  }
  if (
    typeof entry.source !== 'string' ||
    !entry.source.startsWith('https://')
  ) {
    throw new Error(`${entry.id}: source 必须是 https`);
  }
  if (typeof entry.sha256 !== 'string' || !SHA_RE.test(entry.sha256)) {
    throw new Error(`${entry.id}: sha256 非法`);
  }
}

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function createDispatcher() {
  const proxy =
    process.env['HTTPS_PROXY'] ??
    process.env['https_proxy'] ??
    process.env['HTTP_PROXY'] ??
    process.env['http_proxy'];
  if (!proxy) return undefined;
  try {
    return proxy.startsWith('socks')
      ? new Socks5ProxyAgent(proxy)
      : new ProxyAgent(proxy);
  } catch (error) {
    console.warn(
      `[builtin] 代理不可用：${proxy} ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
