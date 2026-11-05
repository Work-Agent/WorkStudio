/**
 * 客户端更新（GitHub Releases，architecture.md §6.5）。
 *
 * 检查：releases/latest API 拿 tag 与资产，按平台 / 架构匹配安装包名，
 * semver 与当前版本比对；有新版才进入下载。下载走共享代理链路
 * （net/proxy），流式写 <下载目录>/<资产名>.part 后原子改名，落定后自动
 * 打开安装包（不静默替换应用：mac ad-hoc 签名不支持 Squirrel 静默更新，
 * 各平台统一「下载 → 自动打开安装包」）。
 */
import { app, dialog, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetch as undiciFetch } from 'undici';
import { createLogger } from '../log';
import { ensureProxy } from '../net/proxy';

const log = createLogger('updater');

const RELEASES_API =
  'https://api.github.com/repos/Work-Agent/WorkStudio/releases/latest';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateAsset {
  name: string;
  /** 资产的 API 端点（带令牌请求，Accept: octet-stream）。 */
  url: string;
  size: number;
}

export interface UpdateStatus {
  phase: UpdatePhase;
  /** 当前安装版本（app.getVersion）。 */
  current: string;
  /** 最新发布 tag（如 v0.2.0）。 */
  latest: string | null;
  /** 本平台对应的安装包资产。 */
  asset: UpdateAsset | null;
  received: number;
  total: number;
  /** 下载完成的安装包绝对路径。 */
  file: string | null;
  message: string | null;
}

interface ReleaseInfo {
  tag_name?: unknown;
  assets?: Array<{
    name?: unknown;
    /** 资产的 API 端点（私有仓库经此 + Accept: octet-stream 下载）。 */
    url?: unknown;
    size?: unknown;
  }>;
}

export interface UpdateServiceOptions {
  /** 读取 GitHub 访问令牌（私有仓库读 Releases），null = 未配置。 */
  token: () => string | null;
}

/** 令牌认证头（未配置时为空对象）。 */
function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 资产端点：私有仓库不能匿名走 browser_download_url，统一走 API。 */
function apiErrorMessage(status: number): string {
  if (status === 404)
    return '仓库不存在或为私有（私有仓库请在下方配置 GitHub Token）';
  if (status === 403) return 'GitHub API 限流或令牌无效，稍后再试';
  if (status === 401) return 'GitHub Token 无效或已过期';
  return `HTTP ${status}`;
}

export class UpdateService {
  private listeners = new Set<() => void>();
  private busy = false;

  constructor(private readonly options: UpdateServiceOptions) {}

  private status: UpdateStatus = {
    phase: 'idle',
    current: app.getVersion(),
    latest: null,
    asset: null,
    received: 0,
    total: 0,
    file: null,
    message: null,
  };

  currentStatus(): UpdateStatus {
    return {
      ...this.status,
      asset: this.status.asset && { ...this.status.asset },
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 检查新版本；失败回滚到检查前状态（不落 error）并抛错给页面 toast。 */
  async check(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    this.busy = true;
    this.patch({ phase: 'checking', message: null });
    try {
      ensureProxy();
      const response = await undiciFetch(RELEASES_API, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/vnd.github+json',
          ...authHeaders(this.options.token()),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(apiErrorMessage(response.status));
      const release = (await response.json()) as ReleaseInfo;
      const latest =
        typeof release.tag_name === 'string' ? release.tag_name : null;
      const asset = pickAsset(release);
      if (!latest) throw new Error('Release 数据不完整（缺少 tag）');
      if (!asset) {
        const suffix = assetSuffix();
        throw new Error(
          suffix
            ? `Release 里没有本平台的安装包：${suffix}`
            : '暂不支持当前平台的自动更新',
        );
      }
      const next = isNewer(latest, this.status.current)
        ? 'available'
        : 'current';
      this.patch({ phase: next, latest, asset, file: null });
      return this.currentStatus();
    } catch (error) {
      // 失败回滚到检查前的状态，避免状态卡在 checking（页面按钮禁用）
      this.patch({
        phase: this.status.asset ? 'available' : 'idle',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** 下载本平台安装包；失败落 error 状态并抛错。 */
  async download(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    const { asset } = this.status;
    if (!asset) throw new Error('请先检查更新');
    this.busy = true;
    try {
      const target = join(app.getPath('downloads'), asset.name);
      const part = `${target}.part`;
      await mkdir(dirname(target), { recursive: true });
      await rm(part, { force: true });
      this.patch({ phase: 'downloading', received: 0, total: asset.size });
      ensureProxy();
      const response = await undiciFetch(asset.url, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/octet-stream',
          ...authHeaders(this.options.token()),
        },
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!response.ok) throw new Error(apiErrorMessage(response.status));
      if (!response.body) throw new Error('下载失败：空响应');
      const total = Number(
        response.headers.get('content-length') ?? asset.size,
      );
      const file = createWriteStream(part);
      let received = 0;
      let emittedAt = 0;
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        file.write(chunk);
        const now = Date.now();
        if (now - emittedAt > 400) {
          emittedAt = now;
          this.patch({ received, total });
        }
      }
      await new Promise<void>((resolve, reject) =>
        file.end((error: Error | null) => (error ? reject(error) : resolve())),
      );
      await rename(part, target);
      // AppImage 需要可执行位才能运行（下载落盘默认 0644）
      if (process.platform === 'linux') await chmod(target, 0o755);
      log.info('update downloaded', target);
      this.patch({ phase: 'ready', received, total, file: target });
      // 下载完打开安装包（mac 挂载 dmg / win 运行安装器 / linux 运行 AppImage）。
      // mac 先弹窗确认并退出应用再打开 dmg：应用运行中拖拽替换会报「正在使用中」。
      if (process.platform === 'darwin') {
        void this.confirmAndInstall(target);
      } else {
        void shell.openPath(target).then((openError) => {
          if (openError) {
            log.warn('update auto open failed', openError);
            this.patch({
              message: `安装包已下载到下载目录，自动打开失败：${openError}`,
            });
          }
        });
      }
      return this.currentStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('update download failed', message);
      this.patch({ phase: 'error', message });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /**
   * mac 安装确认：弹窗让用户选择退出应用并打开 dmg。退出后拖拽替换
   * 不会再遇到「项目正在使用中」；选「稍后」则保持现状（手动处理）。
   */
  private async confirmAndInstall(target: string): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: `新版 ${this.status.latest ?? ''} 已下载完成`,
      detail:
        '点击「退出并安装」将关闭应用并打开安装包，' +
        '请将 WorkStudio 拖入「应用程序」文件夹完成替换。',
      buttons: ['退出并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) {
      this.patch({
        message: `安装包已下载到下载目录：${target}`,
      });
      return;
    }
    const openError = await shell.openPath(target);
    if (openError) {
      log.warn('update auto open failed', openError);
    }
    app.quit();
  }

  private patch(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** 按平台 / 架构匹配安装包资产（产物名不含版本号，见 electron-builder.yml）。 */
function pickAsset(release: ReleaseInfo): UpdateAsset | null {
  const suffix = assetSuffix();
  if (!suffix) return null;
  for (const raw of release.assets ?? []) {
    if (typeof raw.name !== 'string' || typeof raw.url !== 'string') continue;
    if (raw.name !== suffix) continue;
    return {
      name: raw.name,
      url: raw.url,
      size: typeof raw.size === 'number' ? raw.size : 0,
    };
  }
  return null;
}

function assetSuffix(): string | null {
  switch (process.platform) {
    case 'darwin':
      return `WorkStudio-mac-${process.arch}.dmg`;
    case 'win32':
      return `WorkStudio-win-${process.arch}.exe`;
    case 'linux': {
      // electron-builder 的 ${arch} 在 Linux 上渲染为 x86_64（AppImage），
      // 与 Node 的 process.arch（x64）不同，需映射。
      const arch = process.arch === 'x64' ? 'x86_64' : process.arch;
      return `WorkStudio-linux-${arch}.AppImage`;
    }
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
