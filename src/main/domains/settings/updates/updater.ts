/**
 * 客户端更新（GitHub Releases，architecture.md §6.5）。
 *
 * macOS（已签名安装版）：electron-updater（MacUpdater / Squirrel.Mac）静默
 * 更新——检查 GitHub feed（latest-mac.yml），下载本架构 zip，退出应用时自动
 * 静默替换，或主动「重启并安装」；Squirrel 校验新包代码签名与当前应用一致
 * （Team ID），旧 ad-hoc 安装副本无法静默升级到签名版本。
 *
 * 其他平台与 macOS dev 模式：HTTP 管线——releases/latest API 拿 tag 与资产，
 * 按平台 / 架构匹配安装包名，semver 比对；下载走共享代理链路（net/proxy），
 * 流式写 <下载目录>/<资产名>.part 后原子改名，落定后自动打开安装包。
 *
 * 私有仓库：mac 静默链路经 GH_TOKEN 环境变量注入令牌（electron-updater
 * GitHub provider 在首次检查时读取并缓存，之后配置 Token 需重启生效）；
 * HTTP 链路每次请求携带令牌头。
 */
import { app, session, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetch as undiciFetch } from 'undici';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import { createLogger } from '../../../runtime/log.ts';
import { ensureProxy, resolveProxyUrl } from '../../../runtime/net/proxy.ts';

const log = createLogger('updater');

const RELEASES_API =
  'https://api.github.com/repos/Work-Agent/WorkStudio/releases/latest';

/** macOS 已签名安装版走 electron-updater 静默更新；dev 模式与其他平台走 HTTP。 */
const useAutoUpdater = process.platform === 'darwin' && app.isPackaged;

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
  /** 资产来源（HTTP 管线为 API 端点；静默链路为 feed 内文件名）。 */
  url: string;
  size: number;
}

export interface UpdateStatus {
  phase: UpdatePhase;
  /** 是否走静默替换链路（macOS 安装版）；由主进程判定，渲染层不再自行推断。 */
  silent: boolean;
  /** 当前安装版本（app.getVersion）。 */
  current: string;
  /** 最新发布版本号（如 0.3.2）。 */
  latest: string | null;
  /** 本平台对应的更新包资产。 */
  asset: UpdateAsset | null;
  received: number;
  total: number;
  /** HTTP 管线下载完成的安装包绝对路径（静默链路为 null）。 */
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

/** 还原被临时覆盖的环境变量（undefined 表示原本不存在）。 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** 资产端点：私有仓库不能匿名走 browser_download_url，统一走 API。 */
function apiErrorMessage(status: number): string {
  if (status === 404)
    return '仓库不存在或为私有（私有仓库请在下方配置 GitHub Token）';
  if (status === 403) return 'GitHub API 限流或令牌无效，稍后再试';
  if (status === 401) return 'GitHub Token 无效或已过期';
  return `HTTP ${status}`;
}

/** 静默链路错误转译（electron-updater 错误消息较底层）。 */
function autoErrorMessage(message: string, hasToken: boolean): string {
  if (message.includes('404') || message.includes('ENOTFOUND')) {
    return hasToken
      ? '私有仓库拉取更新失败：令牌可能无效，或 Release 缺少 latest-mac.yml'
      : '私有仓库需在下方配置 GitHub Token（配置后需重启应用生效）';
  }
  if (message.includes('401') || message.includes('403')) {
    return 'GitHub Token 无效、过期或限流，稍后再试';
  }
  if (
    message.includes('EPERM') ||
    message.includes('EACCES') ||
    message.includes('ERR_UPDATER')
  ) {
    return `无法应用更新（应用需位于「应用程序」文件夹且已签名安装）：${message}`;
  }
  return message;
}

/** electron-updater 走 Electron net（默认 session），代理须经 session 注入。 */
async function applySessionProxy(): Promise<void> {
  const proxy = resolveProxyUrl();
  try {
    await session.defaultSession.setProxy(
      proxy ? { proxyRules: proxy } : { mode: 'direct' },
    );
  } catch (error) {
    log.warn('session proxy apply failed, direct', error);
  }
}

/** feed 内挑出当前架构的 zip 条目（产物名含 arch，见 electron-builder.yml）。 */
function pickMacAsset(info: UpdateInfo | null | undefined): UpdateAsset | null {
  const zips = (info?.files ?? []).filter(
    (file) =>
      typeof file.url === 'string' && file.url.toLowerCase().endsWith('.zip'),
  );
  const expected = `WorkStudio-mac-${process.arch}.zip`;
  const chosen =
    zips.find((file) => (file.url.split('/').pop() ?? '') === expected) ??
    zips.find((file) => file.url.includes(process.arch));
  if (!chosen) return null;
  const url = chosen.url;
  return {
    name: url.split('/').pop() ?? url,
    url,
    size: typeof chosen.size === 'number' ? chosen.size : 0,
  };
}

export class UpdateService {
  private listeners = new Set<() => void>();
  private busy = false;
  private controller: AbortController | null = null;

  constructor(private readonly options: UpdateServiceOptions) {}

  private status: UpdateStatus = {
    phase: 'idle',
    silent: useAutoUpdater,
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

  check(): Promise<UpdateStatus> {
    return useAutoUpdater ? this.checkAuto() : this.checkHttp();
  }

  download(): Promise<UpdateStatus> {
    return useAutoUpdater ? this.downloadAuto() : this.downloadHttp();
  }

  cancel(): UpdateStatus {
    if (useAutoUpdater) {
      // Squirrel 下载不可中止；mac 设置页不展示取消入口。
      return this.currentStatus();
    }
    this.controller?.abort();
    if (this.status.phase === 'downloading') {
      this.patch({ phase: 'idle', message: '下载已取消' });
    }
    return this.currentStatus();
  }

  /** 应用更新：mac 静默链路重启并替换（Squirrel）；其他平台打开安装包。 */
  install(): UpdateStatus {
    if (useAutoUpdater) {
      // 未下载完成时调用 quitAndInstall 会让 Squirrel 拿到空缓存直接失败
      if (this.status.phase !== 'ready') throw new Error('更新尚未下载完成');
      log.info('quit and install mac update');
      autoUpdater.quitAndInstall();
      return this.currentStatus();
    }
    const file = this.status.file;
    if (file) void shell.openPath(file);
    return this.currentStatus();
  }

  /**
   * 静默检查：令牌注入环境变量（provider 首次检查时读取并缓存），
   * session 代理就位后查 feed；semver 比对落 available / current。
   */
  private async checkAuto(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    this.busy = true;
    const previousPhase = this.status.phase;
    this.patch({ phase: 'checking', message: null });
    // electron-updater 在首次检查时创建 provider 并从环境变量取令牌；
    // 用完立即还原，避免令牌随进程环境泄漏给后续 spawn 的子进程。
    const token = this.options.token();
    const previousGhToken = process.env['GH_TOKEN'];
    const previousGithubToken = process.env['GITHUB_TOKEN'];
    if (token) {
      process.env['GH_TOKEN'] = token;
      process.env['GITHUB_TOKEN'] = token;
    }
    try {
      await applySessionProxy();
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      const result = await autoUpdater.checkForUpdates();
      const latest = result?.updateInfo.version ?? null;
      if (!latest) throw new Error('更新数据不完整（缺少版本号）');
      const asset = pickMacAsset(result?.updateInfo);
      if (!asset) {
        throw new Error('Release 里没有本平台的更新包（WorkStudio-mac-*.zip）');
      }
      this.patch({
        phase: isNewer(latest, this.status.current) ? 'available' : 'current',
        latest,
        asset,
        file: null,
      });
      return this.currentStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('mac update check failed', message);
      // 已下载就绪的更新不能被一次失败的复检降级，否则「重启并安装」入口消失
      this.patch({
        phase:
          previousPhase === 'ready'
            ? 'ready'
            : this.status.asset
              ? 'available'
              : 'idle',
        message: autoErrorMessage(message, Boolean(token)),
      });
      throw error;
    } finally {
      if (token) {
        restoreEnv('GH_TOKEN', previousGhToken);
        restoreEnv('GITHUB_TOKEN', previousGithubToken);
      }
      this.busy = false;
    }
  }

  /** 静默下载：进度映射到状态；完成后 Squirrel 已就位，退出即替换。 */
  private async downloadAuto(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    if (this.status.phase !== 'available') throw new Error('请先检查更新');
    this.busy = true;
    try {
      await applySessionProxy();
      const total = this.status.asset?.size ?? 0;
      this.patch({ phase: 'downloading', received: 0, total });
      const onProgress = (progress: {
        transferred: number;
        total: number;
      }): void => {
        this.patch({ received: progress.transferred, total: progress.total });
      };
      autoUpdater.on('download-progress', onProgress);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.removeListener('download-progress', onProgress);
      }
      log.info('mac update downloaded, install on quit or via install');
      this.patch({
        phase: 'ready',
        total,
        received: total,
        message:
          '更新已就绪：退出应用时自动静默替换，或点「重启并安装」立即更新',
      });
      return this.currentStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('mac update download failed', message);
      this.patch({ phase: 'error', message: autoErrorMessage(message, true) });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** 检查新版本；失败回滚到检查前状态（不落 error）并抛错给页面 toast。 */
  private async checkHttp(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    this.busy = true;
    const previousPhase = this.status.phase;
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
      // 失败回滚到检查前的状态，避免状态卡在 checking（页面按钮禁用）；
      // 已下载就绪的更新保持 ready，防止入口消失
      this.patch({
        phase:
          previousPhase === 'ready'
            ? 'ready'
            : this.status.asset
              ? 'available'
              : 'idle',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** 下载本平台安装包；失败落 error 状态并抛错。 */
  private async downloadHttp(): Promise<UpdateStatus> {
    if (this.busy) return this.currentStatus();
    const { asset } = this.status;
    if (!asset) throw new Error('请先检查更新');
    this.busy = true;
    this.controller = new AbortController();
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
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(30 * 60_000),
        ]),
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
      // 下载完打开安装包（win 运行安装器 / linux 运行 AppImage / mac dev 挂载 dmg）
      void shell.openPath(target).then((openError) => {
        if (openError) {
          log.warn('update auto open failed', openError);
          this.patch({
            message: `安装包已下载到下载目录，自动打开失败：${openError}`,
          });
        }
      });
      return this.currentStatus();
    } catch (error) {
      if (this.controller?.signal.aborted) {
        this.patch({ phase: 'idle', message: '下载已取消' });
        return this.currentStatus();
      }
      const message = error instanceof Error ? error.message : String(error);
      log.warn('update download failed', message);
      this.patch({ phase: 'error', message });
      throw error;
    } finally {
      this.controller = null;
      this.busy = false;
    }
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
