/**
 * 工作区文件适配器：file:// ref ↔ 工作区目录。
 *
 * 只做枚举、读取与写入；不解释格式，也不做 codec / presenter。
 * 所有路径必须落在工作区根内，越界一律拒绝。
 */

import type { Stats } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CallFailure } from '../contract.ts';
import type {
  Entry,
  Item,
  ListOptions,
  ReadOptions,
  ResourceAdapter,
} from './resource.ts';

const MAX_ITEMS = 500;
const MAX_GREP_BYTES = 4 * 1024 * 1024;

export class WorkspaceFiles implements ResourceAdapter {
  private root: string;
  /** 已登记的工作区根：读操作可跨工作区（多窗口并行）。 */
  private roots: string[];

  constructor(root: string) {
    this.root = resolve(root);
    this.roots = [this.root];
  }

  /** 工作区切换：只换根，不重建适配器。 */
  setRoot(root: string): void {
    this.root = resolve(root);
  }

  setRoots(roots: readonly string[]): void {
    this.roots = roots.map((root) => resolve(root));
  }

  refOf(path: string): string {
    return pathToFileURL(resolve(path)).toString();
  }

  async ls(ref: string, options: ListOptions = {}): Promise<Entry[]> {
    const path = this.pathOf(ref, 'read');
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) return [];
    const names = await readdir(path);
    const bounded = names.slice(
      0,
      Math.min(options.limit ?? MAX_ITEMS, MAX_ITEMS),
    );
    const result: Entry[] = [];
    for (const name of bounded) {
      const child = join(path, name);
      const childInfo = await stat(child).catch(() => null);
      if (!childInfo) continue;
      result.push({
        name,
        type: childInfo.isDirectory()
          ? 'dir'
          : childInfo.isFile()
            ? 'file'
            : 'other',
        ...(childInfo.isFile() ? { size: childInfo.size } : {}),
        modifiedAt: childInfo.mtimeMs,
        ref: this.refOf(child),
      });
    }
    return result;
  }

  async find(ref: string, query: string): Promise<Entry[]> {
    const root = this.pathOf(ref, 'read');
    const matcher = globToRegExp(query);
    const result: Entry[] = [];
    await this.walk(root, async (path, info) => {
      if (result.length >= MAX_ITEMS) return false;
      const name = path.slice(path.lastIndexOf(sep) + 1);
      if (!matcher.test(name) && !matcher.test(path)) return true;
      result.push({
        name,
        type: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other',
        ...(info.isFile() ? { size: info.size } : {}),
        modifiedAt: info.mtimeMs,
        ref: this.refOf(path),
      });
      return true;
    });
    return result;
  }

  async read(ref: string, options: ReadOptions = {}): Promise<Item[]> {
    const path = this.pathOf(ref, 'read');
    const info = await stat(path).catch(() => null);
    if (!info?.isFile())
      throw new CallFailure('not_found', `文件不存在：${ref}`);
    const bytes = await readFile(path);
    const text = decodeText(bytes);
    const lines = text.split('\n');
    const offset = Math.max(0, (options.offset ?? 1) - 1);
    const limit = Math.max(1, Math.min(options.limit ?? 200, 2000));
    const content = lines.slice(offset, offset + limit).join('\n');
    return [
      {
        locator: `${ref}#L${offset + 1}`,
        text: content,
        ...(text.length !== content.length
          ? { truncated: true, totalLines: lines.length }
          : {}),
      },
    ];
  }

  async grep(ref: string, query: string): Promise<Item[]> {
    const root = this.pathOf(ref, 'read');
    const regex = new RegExp(query, 'i');
    const result: Item[] = [];
    let scanned = 0;
    await this.walk(root, async (path, info) => {
      if (result.length >= MAX_ITEMS || scanned >= MAX_ITEMS) return false;
      if (!info.isFile() || info.size > MAX_GREP_BYTES) return true;
      scanned += 1;
      const bytes = await readFile(path).catch(() => null);
      if (!bytes) return true;
      const text = decodeText(bytes);
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (!regex.test(line)) continue;
        result.push({
          locator: `${this.refOf(path)}#L${index + 1}`,
          ref: this.refOf(path),
          line: index + 1,
          snippet: line.slice(0, 240),
        });
        if (result.length >= MAX_ITEMS) break;
      }
      return true;
    });
    return result;
  }

  async readBytes(ref: string): Promise<Uint8Array> {
    return readFile(this.pathOf(ref, 'read'));
  }

  async writeBytes(ref: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathOf(ref, 'write');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  /** 读操作认所有已登记工作区；写操作只认当前工作区。 */
  private pathOf(ref: string, access: 'read' | 'write' = 'write'): string {
    let path: string;
    try {
      path = fileURLToPath(ref);
    } catch {
      throw new CallFailure('invalid', `不是 file:// 地址：${ref}`);
    }
    const absolute = resolve(path);
    const roots = access === 'read' ? this.roots : [this.root];
    if (!roots.some((root) => isWithin(root, absolute))) {
      throw new CallFailure('denied', `路径不在工作区：${ref}`);
    }
    return absolute;
  }

  private async walk(
    root: string,
    visit: (path: string, info: Stats) => Promise<boolean>,
  ): Promise<void> {
    const info = await stat(root).catch(() => null);
    if (!info) return;
    if (!info.isDirectory()) {
      await visit(root, info);
      return;
    }
    const names = await readdir(root).catch(() => []);
    for (const name of names) {
      const path = join(root, name);
      const child = await stat(path).catch(() => null);
      if (!child) continue;
      if (!(await visit(path, child))) return;
      if (child.isDirectory()) await this.walk(path, visit);
    }
  }
}

function isWithin(root: string, path: string): boolean {
  if (!isAbsolute(path)) return false;
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
