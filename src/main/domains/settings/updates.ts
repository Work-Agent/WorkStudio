/**
 * 应用更新：按用户选择的来源检查 / 下载 / 安装。
 *
 * 来源两种：
 * - github：GitHub Releases。macOS 已签名安装版（electron-updater / Squirrel.Mac）
 *   静默更新——读 GitHub feed（latest-mac.yml），下载本架构 zip，退出应用时自动
 *   静默替换，或点「重启并安装」立即替换；dev 模式与其他平台走 HTTP 管线。
 * - cos：腾讯云 COS 镜像——读 latest.json 清单，所有平台统一走 HTTP 下载，
 *   下载完成后交给系统打开安装包（不走 Squirrel 静默替换）。
 *
 * 私有仓库：静默链路经 GH_TOKEN 环境变量注入令牌（electron-updater GitHub
 * provider 在首次检查时读取并缓存，之后改 Token 需重启生效）；HTTP 链路每次
 * 请求携带令牌头，并统一走默认 session 的 fetch 以复用用户代理设置。
 */

import { app, session, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import type { StorageLayout } from '../../platform/paths.ts';
import {
  readUserPreferences,
  type UpdateSource,
} from '../../platform/preferences.ts';
import { createLog } from '../../log.ts';

const log = createLog('updates');

const RELEASES_API =
  'https://api.github.com/repos/Work-Agent/WorkStudio/releases/latest';
/** 镜像布局：<base>/latest.json 与 <base>/<tag>/<安装包>。 */
const COS_BASE_URL = 'https://ai-1301618848.cos.ap-nanjing.myqcloud.com/data';

/** macOS 已签名安装版具备静默更新能力；是否启用还取决于更新源。 */
const SILENT_CAPABLE = process.platform === 'darwin' && app.isPackaged;

export type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateAsset {
  /** 资产所属来源：GitHub 资产直链需要令牌，COS 为公开读。 */
  source: UpdateSource;
  name: string;
  /** 资产来源（HTTP 管线为 API 端点 / COS 直链；静默链路为 feed 内文件名）。 */
  url: string;
  size: number;
}

export interface UpdateStatus {
  phase: Phase;
  /** 是否走静默替换链路（macOS 安装版且来源为 GitHub）。 */
  silent: boolean;
  source: UpdateSource;
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

interface ResolvedUpdate {
  version: string;
  asset: UpdateAsset;
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

/** HTTP 错误转译：私有仓库未配置令牌时 404 无法区分「不存在」与「无权限」。 */
function apiErrorMessage(status: number): string {
  if (status === 404) return '仓库不存在或为私有（请在下方配置 GitHub Token）';
  if (status === 403) return 'GitHub API 限流或令牌无效，稍后再试';
  if (status === 401) return 'GitHub Token 无效或已过期';
  return `更新检查失败：HTTP ${status}`;
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
let appliedProxy: string | null = null;
async function applySessionProxy(layout: StorageLayout): Promise<void> {
  const proxy = readUserPreferences(layout).proxy;
  if (proxy === appliedProxy) return;
  try {
    await session.defaultSession.setProxy(
      proxy ? { proxyRules: proxy } : { mode: 'system' },
    );
    appliedProxy = proxy;
  } catch (error) {
    log.warn(
      `session proxy apply failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * HTTP 管线统一走默认 session 的 fetch：Node 原生 fetch 不读任何代理，
 * 大陆网络直连 GitHub 会极慢甚至超时；session fetch 经 applySessionProxy
 * 注入用户偏好代理（未配置时跟随系统），与静默链路行为一致。
 */
async function sessionFetch(
  layout: StorageLayout,
  url: string,
  init: RequestInit,
): Promise<Response> {
  await applySessionProxy(layout);
  return (await session.defaultSession.fetch(
    url,
    init as Parameters<Electron.Session['fetch']>[1],
  )) as unknown as Response;
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
    source: 'github',
    name: url.split('/').pop() ?? url,
    url,
    size: typeof chosen.size === 'number' ? chosen.size : 0,
  };
}

export class UpdatesService {
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private busy = false;

  private status: UpdateStatus = {
    phase: 'idle',
    silent: SILENT_CAPABLE,
    source: 'github',
    current: app.getVersion(),
    latest: null,
    asset: null,
    received: 0,
    total: 0,
    file: null,
    message: null,
  };

  constructor(private readonly layout: StorageLayout) {}

  current(): UpdateStatus {
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
    // 只有 GitHub 源支持 macOS 静默替换；COS 镜像一律走 HTTP 下载。
    return SILENT_CAPABLE && this.source() === 'github'
      ? this.checkAuto()
      : this.checkHttp();
  }

  download(): Promise<UpdateStatus> {
    return this.status.silent && this.source() === 'github'
      ? this.downloadAuto()
      : this.downloadHttp();
  }

  cancel(): UpdateStatus {
    if (this.status.silent) {
      // Squirrel 下载不可中止；mac 设置页不展示取消入口。
      return this.current();
    }
    this.controller?.abort();
    if (this.status.phase === 'downloading') {
      this.patch({ phase: 'idle', message: '下载已取消' });
    }
    return this.current();
  }

  /** 应用更新：静默链路重启并替换（Squirrel）；其他平台打开安装包。 */
  install(): UpdateStatus {
    if (this.status.silent) {
      // 未下载完成时调用 quitAndInstall 会让 Squirrel 拿到空缓存直接失败
      if (this.status.phase !== 'ready') throw new Error('更新尚未下载完成');
      log.info('quit and install mac update');
      autoUpdater.quitAndInstall();
      return this.current();
    }
    const file = this.status.file;
    if (file) void shell.openPath(file);
    return this.current();
  }

  /** 打开已下载的安装包（HTTP 管线）；静默链路由 install 负责。 */
  open(): void {
    if (this.status.file) void shell.openPath(this.status.file);
  }

  /**
   * 静默检查：令牌注入环境变量（provider 首次检查时读取并缓存），
   * session 代理就位后查 feed；semver 比对落 available / current。
   */
  private async checkAuto(): Promise<UpdateStatus> {
    if (this.busy) return this.current();
    this.busy = true;
    const previousPhase = this.status.phase;
    const sourceChanged = this.status.source !== 'github';
    this.patch({
      phase: 'checking',
      silent: true,
      source: 'github',
      message: null,
      // 从 COS 切回 GitHub 时清掉旧来源的版本与资产，避免失败后误报「有新版本」。
      ...(sourceChanged
        ? { latest: null, asset: null, received: 0, total: 0, file: null }
        : {}),
    });
    // electron-updater 在首次检查时创建 provider 并从环境变量取令牌；
    // 用完立即还原，避免令牌随进程环境泄漏给后续 spawn 的子进程。
    const token = this.token();
    const previousGhToken = process.env['GH_TOKEN'];
    const previousGithubToken = process.env['GITHUB_TOKEN'];
    if (token) {
      process.env['GH_TOKEN'] = token;
      process.env['GITHUB_TOKEN'] = token;
    }
    try {
      await applySessionProxy(this.layout);
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
      return this.current();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`mac update check failed: ${message}`);
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
    if (this.busy) return this.current();
    if (this.status.phase !== 'available') throw new Error('请先检查更新');
    this.busy = true;
    try {
      await applySessionProxy(this.layout);
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
      return this.current();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`mac update download failed: ${message}`);
      this.patch({ phase: 'error', message: autoErrorMessage(message, true) });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  /** HTTP 检查：按来源取最新版本与资产；失败回滚到检查前状态。 */
  private async checkHttp(): Promise<UpdateStatus> {
    if (this.busy) return this.current();
    this.busy = true;
    const source = this.source();
    const previousPhase = this.status.phase;
    const sourceChanged = this.status.source !== source;
    this.patch({
      phase: 'checking',
      silent: false,
      source,
      message: null,
      // 切换来源时清掉旧来源的版本与资产，避免失败后误报「有新版本」。
      ...(sourceChanged
        ? { latest: null, asset: null, received: 0, total: 0, file: null }
        : {}),
    });
    try {
      const resolved = await this.resolve(source);
      this.patch({
        phase: isNewer(resolved.version, this.status.current)
          ? 'available'
          : 'current',
        latest: resolved.version,
        asset: resolved.asset,
        received: 0,
        total: resolved.asset.size,
        file: null,
        message: null,
      });
      return this.current();
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
    if (this.busy) return this.current();
    const asset = await this.currentAsset();
    this.busy = true;
    this.controller = new AbortController();
    const target = join(this.layout.dataRoot, 'updates', asset.name);
    const part = `${target}.part`;
    try {
      await mkdir(join(this.layout.dataRoot, 'updates'), { recursive: true });
      await rm(part, { force: true });
      this.patch({ phase: 'downloading', received: 0, total: asset.size });
      const response = await sessionFetch(this.layout, asset.url, {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/octet-stream',
          // GitHub 资产需要令牌；COS 公开读，带上令牌反而可能触发签名冲突。
          ...(asset.source === 'github' ? authHeaders(this.token()) : {}),
        },
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(30 * 60_000),
        ]),
      });
      if (!response.ok || !response.body) {
        throw new Error(
          asset.source === 'cos'
            ? mirrorErrorMessage(response.status)
            : apiErrorMessage(response.status),
        );
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
      // AppImage 需要可执行位才能运行（下载落盘默认 0644）
      if (process.platform === 'linux') await chmod(target, 0o755);
      log.info(`update downloaded: ${target}`);
      this.patch({ phase: 'ready', received, total, file: target });
      // 下载完打开安装包（win 运行安装器 / linux 运行 AppImage / mac 挂载 dmg）
      void shell.openPath(target).then((openError) => {
        if (openError) {
          log.warn(`update auto open failed: ${openError}`);
          this.patch({
            message: `安装包已下载，自动打开失败：${openError}`,
          });
        }
      });
      return this.current();
    } catch (error) {
      if (this.controller?.signal.aborted) {
        this.patch({ phase: 'idle', message: '下载已取消' });
        return this.current();
      }
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`update download failed: ${message}`);
      this.patch({ phase: 'error', message });
      throw error;
    } finally {
      this.controller = null;
      this.busy = false;
    }
  }

  private source(): UpdateSource {
    return readUserPreferences(this.layout).updateSource;
  }

  /** 下载前对齐来源：用户可能刚切换过更新源。 */
  private async currentAsset(): Promise<UpdateAsset> {
    const source = this.source();
    const current = this.status.asset;
    if (current && current.source === source) return current;
    const resolved = await this.resolve(source);
    this.patch({
      source,
      latest: resolved.version,
      asset: resolved.asset,
      received: 0,
      total: resolved.asset.size,
    });
    return resolved.asset;
  }

  private resolve(source: UpdateSource): Promise<ResolvedUpdate> {
    return source === 'cos' ? this.resolveCos() : this.resolveGitHub();
  }

  private async resolveGitHub(): Promise<ResolvedUpdate> {
    const response = await sessionFetch(this.layout, RELEASES_API, {
      headers: {
        'User-Agent': 'work-studio',
        Accept: 'application/vnd.github+json',
        ...authHeaders(this.token()),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(apiErrorMessage(response.status));
    const release = (await response.json()) as ReleaseInfo;
    const version =
      typeof release.tag_name === 'string' ? release.tag_name : null;
    if (!version) throw new Error('Release 数据不完整（缺少 tag）');
    const asset = this.pickAsset(release.assets ?? []);
    if (!asset) throw new Error('Release 里没有本平台的安装包');
    return { version, asset };
  }

  private async resolveCos(): Promise<ResolvedUpdate> {
    const response = await sessionFetch(
      this.layout,
      `${COS_BASE_URL}/latest.json?t=${Date.now()}`,
      {
        headers: {
          'User-Agent': 'work-studio',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error(mirrorErrorMessage(response.status));
    const manifest = (await response.json()) as {
      version?: unknown;
      tag?: unknown;
      assets?: Record<string, { name?: unknown; size?: unknown }>;
    };
    const version =
      typeof manifest.version === 'string' && manifest.version.trim()
        ? manifest.version.trim()
        : null;
    if (!version) throw new Error('镜像清单缺少 version');
    const dir =
      typeof manifest.tag === 'string' && manifest.tag.trim()
        ? manifest.tag.trim()
        : version;
    const entry = manifest.assets?.[assetKey()];
    const name =
      entry && typeof entry.name === 'string' && entry.name.trim()
        ? entry.name
        : null;
    if (!name) throw new Error('镜像缺少当前平台安装包');
    return {
      version,
      asset: {
        source: 'cos',
        name,
        url: `${COS_BASE_URL}/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`,
        size: typeof entry?.size === 'number' ? entry.size : 0,
      },
    };
  }

  private pickAsset(
    assets: Array<{ name?: unknown; url?: unknown; size?: unknown }>,
  ): UpdateAsset | null {
    const suffix = assetSuffix();
    if (!suffix) return null;
    for (const raw of assets) {
      if (raw.name !== suffix || typeof raw.url !== 'string') continue;
      return {
        source: 'github',
        name: suffix,
        url: raw.url,
        size: typeof raw.size === 'number' ? raw.size : 0,
      };
    }
    return null;
  }

  private token(): string | null {
    return (
      process.env['GITHUB_TOKEN'] ??
      readUserPreferences(this.layout).githubToken ??
      null
    );
  }

  private patch(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** COS 对不存在或不可读的对象都返回 403；提示「尚未发布」更贴近用户预期。 */
function mirrorErrorMessage(status: number): string {
  return status === 403 || status === 404
    ? '镜像尚未发布更新，请改用 GitHub 或稍后重试'
    : `更新检查失败：镜像 HTTP ${status}`;
}

/** 镜像清单的资产键：<platform>-<arch>，与发布脚本一致。 */
function assetKey(): string {
  return `${process.platform}-${process.arch}`;
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
