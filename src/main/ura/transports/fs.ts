// ─── 内置来源：file ─────────────────────────────────────────────────
//
// 唯一触达文件系统的地方。版本 = 内容哈希；写入原子化（临时文件 + 改名）。
// 格式提示按扩展名给出，越具体越靠前；不做内容探测。

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat as fsStat,
  writeFile,
} from 'node:fs/promises';
import { statSync, watch as fsWatch, watchFile, unwatchFile } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ChangeEvent,
  ListEntry,
  Patch,
  RawContent,
  ResourceStat,
  Transport,
  TransportCapability,
  TransportId,
  TransportWriteOptions,
  TransportWriteResult,
} from '../../../shared/ura';
import { formatRef, mimeFromExtension, parseRef } from '../../../shared/ura';
import { UraError } from '../errors';

const decoder = new TextDecoder();

export class FileTransport implements Transport {
  readonly id: TransportId = 'file';
  readonly scheme = 'file';
  readonly capabilities: readonly TransportCapability[] = [
    'read',
    'write',
    'list',
    'watch',
  ];

  async stat(ref: string): Promise<ResourceStat> {
    const path = filePath(ref);
    const info = await fsStat(path).catch(() => null);
    if (!info) throw new UraError('resource.not-found', `资源不存在：${ref}`);
    if (info.isDirectory()) {
      return { version: `d-${Math.floor(info.mtimeMs)}`, type: 'dir', size: 0 };
    }
    const bytes = await readFile(path);
    return {
      version: versionOf(bytes),
      type: 'file',
      size: bytes.length,
      mtimeMs: info.mtimeMs,
    };
  }

  async read(ref: string): Promise<RawContent> {
    const path = filePath(ref);
    const info = await fsStat(path).catch(() => null);
    if (!info) throw new UraError('resource.not-found', `资源不存在：${ref}`);

    if (info.isDirectory()) {
      return {
        bytes: new Uint8Array(),
        version: `d-${Math.floor(info.mtimeMs)}`,
        type: 'dir',
        size: 0,
      };
    }

    const bytes = await readFile(path);
    const ext = extensionOf(path);
    return {
      bytes,
      version: versionOf(bytes),
      type: 'file',
      size: bytes.length,
      mtimeMs: info.mtimeMs,
      mime: mimeFromExtension(ext),
    };
  }

  async write(
    ref: string,
    patch: Patch,
    _opts: TransportWriteOptions,
  ): Promise<TransportWriteResult> {
    const path = filePath(ref);
    const current = await readFile(path).catch(() => null);

    let next: Uint8Array;
    if (patch.type === 'replace-all') {
      next = patch.bytes;
    } else {
      if (!current)
        throw new UraError('resource.not-found', `资源不存在：${ref}`);
      if (
        patch.start < 0 ||
        patch.end > current.length ||
        patch.start > patch.end
      ) {
        throw new UraError('write.invalid-range', `补丁范围越界：${ref}`);
      }
      if (patch.expected !== undefined) {
        const actual = decoder.decode(current.subarray(patch.start, patch.end));
        if (actual !== patch.expected) {
          throw new UraError('write.stale-patch', `补丁基线不匹配：${ref}`);
        }
      }
      next = new Uint8Array(
        current.length - (patch.end - patch.start) + patch.bytes.length,
      );
      next.set(current.subarray(0, patch.start), 0);
      next.set(patch.bytes, patch.start);
      next.set(current.subarray(patch.end), patch.start + patch.bytes.length);
    }

    await mkdir(dirname(path), { recursive: true });
    const temp = join(dirname(path), `.${Date.now()}.${process.pid}.tmp`);
    await writeFile(temp, next);
    await rename(temp, path);
    await rm(temp, { force: true }).catch(() => undefined);
    return { version: versionOf(next) };
  }

  async list(ref: string): Promise<ListEntry[]> {
    const path = filePath(ref);
    const parent = parseRef(ref);
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => null,
    );
    if (!entries)
      throw new UraError('resource.not-found', `目录不存在：${ref}`);
    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        ref: formatRef({
          ...parent,
          path: posix.join(parent.path, entry.name),
        }),
        type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other',
      }));
  }

  watch(ref: string, emit: (event: ChangeEvent) => void): () => void {
    const path = filePath(ref);
    let timer: NodeJS.Timeout | undefined;
    const notify = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void this.stat(ref)
          .then((info) =>
            emit({
              ref,
              type: 'content',
              version: info.version,
              at: Date.now(),
            }),
          )
          .catch(() => emit({ ref, type: 'structure', at: Date.now() }));
      }, 150);
    };

    let stop: () => void;
    if (isDirectory(path)) {
      const watcher = fsWatch(path, { persistent: false }, notify);
      stop = () => watcher.close();
    } else {
      const listener = (): void => notify();
      watchFile(path, { interval: 300 }, listener);
      stop = () => unwatchFile(path, listener);
    }
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function filePath(ref: string): string {
  const parsed = parseRef(ref);
  if (parsed.scheme !== 'file')
    throw new UraError('transport.mismatch', `非 file 资源：${ref}`);
  const raw = parsed.authority
    ? `//${parsed.authority}${parsed.path}`
    : parsed.path;
  try {
    return fileURLToPath(`file://${raw}`);
  } catch {
    return decodeURIComponent(raw);
  }
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index + 1).toLowerCase();
}

function versionOf(bytes: Uint8Array): string {
  return `v1-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}`;
}
