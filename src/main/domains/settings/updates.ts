/**
 * 应用更新：GitHub Releases 检查 / 下载 / 取消。
 *
 * 只做客户端更新流程；状态由 UpdatesService 持有，settings/updates 资源
 * 只做投影。下载完成后交给系统打开安装包。
 */

import { app, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageLayout } from '../../platform/paths.ts';
import { readUserPreferences } from '../../platform/preferences.ts';

const RELEASES_API =
  'https://api.github.com/repos/Work-Agent/WorkStudio/releases/latest';

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateStatus {
  phase: Phase;
  current: string;
  latest: string | null;
  received: number;
  total: number;
  file: string | null;
  message: string | null;
}

export class UpdatesService {
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private busy = false;
  private status: UpdateStatus = {
    phase: 'idle',
    current: app.getVersion(),
    latest: null,
    received: 0,
    total: 0,
    file: null,
    message: null,
  };

  constructor(private readonly layout: StorageLayout) {}

  current(): UpdateStatus {
    return { ...this.status };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<UpdateStatus> {
    if (this.busy) return this.current();
    this.busy = true;
    this.patch({ phase: 'checking', message: null });
    try {
      const response = await fetch(RELEASES_API, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/vnd.github+json',
          ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new Error(`更新检查失败：HTTP ${response.status}`);
      const release = (await response.json()) as {
        tag_name?: unknown;
        assets?: Array<{ name?: unknown; url?: unknown; size?: unknown }>;
      };
      const latest =
        typeof release.tag_name === 'string' ? release.tag_name : null;
      if (!latest) throw new Error('Release 缺少 tag');
      const asset = this.pickAsset(release.assets ?? []);
      if (!asset) throw new Error('Release 缺少当前平台安装包');
      this.patch({
        phase: isNewer(latest, this.status.current) ? 'available' : 'current',
        latest,
        received: 0,
        total: asset.size,
        file: null,
        message: null,
      });
      return this.current();
    } catch (error) {
      this.patch({
        phase: this.status.latest ? 'available' : 'idle',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async download(): Promise<UpdateStatus> {
    if (this.busy) return this.current();
    const latest = this.status.latest;
    if (!latest) throw new Error('请先检查更新');
    const asset = await this.resolveAsset(latest);
    if (!asset) throw new Error('Release 缺少当前平台安装包');
    this.busy = true;
    this.controller = new AbortController();
    const target = join(this.layout.dataRoot, 'updates', asset.name);
    const part = `${target}.part`;
    try {
      await mkdir(join(this.layout.dataRoot, 'updates'), { recursive: true });
      await rm(part, { force: true });
      this.patch({ phase: 'downloading', received: 0, total: asset.size });
      const response = await fetch(asset.url, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/octet-stream',
          ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
        },
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(30 * 60_000),
        ]),
      });
      if (!response.ok || !response.body) {
        throw new Error(`更新下载失败：HTTP ${response.status}`);
      }
      const total = Number(
        response.headers.get('content-length') ?? asset.size,
      );
      const file = createWriteStream(part);
      let received = 0;
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        file.write(chunk);
        this.patch({ received, total });
      }
      await new Promise<void>((resolve, reject) =>
        file.end((error: Error | null) => (error ? reject(error) : resolve())),
      );
      await rename(part, target);
      if (process.platform === 'linux') await chmod(target, 0o755);
      this.patch({ phase: 'ready', received, total, file: target });
      void shell.openPath(target).then((error) => {
        if (error) this.patch({ message: `安装包打开失败：${error}` });
      });
      return this.current();
    } catch (error) {
      if (this.controller?.signal.aborted) {
        this.patch({ phase: 'idle', message: '下载已取消' });
        return this.current();
      }
      this.patch({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.controller = null;
      this.busy = false;
    }
  }

  cancel(): UpdateStatus {
    this.controller?.abort();
    if (this.status.phase === 'downloading') {
      this.patch({ phase: 'idle', message: '下载已取消' });
    }
    return this.current();
  }

  open(): void {
    if (this.status.file) void shell.openPath(this.status.file);
  }

  private token(): string | null {
    return (
      process.env['GITHUB_TOKEN'] ??
      readUserPreferences(this.layout).githubToken ??
      null
    );
  }

  private async resolveAsset(
    tag: string,
  ): Promise<{ name: string; url: string; size: number } | null> {
    const response = await fetch(RELEASES_API, {
      headers: {
        'User-Agent': 'work-studio',
        Accept: 'application/vnd.github+json',
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const release = (await response.json()) as {
      tag_name?: unknown;
      assets?: Array<{ name?: unknown; url?: unknown; size?: unknown }>;
    };
    if (release.tag_name !== tag) return null;
    return this.pickAsset(release.assets ?? []);
  }

  private pickAsset(
    assets: Array<{ name?: unknown; url?: unknown; size?: unknown }>,
  ): { name: string; url: string; size: number } | null {
    const suffix = assetSuffix();
    if (!suffix) return null;
    for (const asset of assets) {
      if (asset.name !== suffix || typeof asset.url !== 'string') continue;
      return {
        name: suffix,
        url: asset.url,
        size: typeof asset.size === 'number' ? asset.size : 0,
      };
    }
    return null;
  }

  private patch(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function assetSuffix(): string | null {
  switch (process.platform) {
    case 'darwin':
      return `WorkStudio-mac-${process.arch}.dmg`;
    case 'win32':
      return `WorkStudio-win-${process.arch}.exe`;
    case 'linux':
      return `WorkStudio-linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`;
    default:
      return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  return a[0] !== b[0]
    ? a[0] > b[0]
    : a[1] !== b[1]
      ? a[1] > b[1]
      : a[2] > b[2];
}

function parseVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
