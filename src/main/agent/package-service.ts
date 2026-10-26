/**
 * Pi 包服务（architecture.md §7.4）—— 社区目录 + 安装 / 卸载 / 清单。
 *
 * 目录：pi.dev 无公开 JSON API（/api/* 返回 501）；包目录页为 SSR HTML，
 * 抓 `?name=`（模糊搜索）/ `?type=`（过滤）/ `?page=`（分页）并解析卡片。
 * 安装：pi `DefaultPackageManager`（npm: / git: / 本地路径）——写 settings.json 的
 * `packages` 并落盘依赖；安装后由装配层热重载会话资源（扩展 / 技能 / 提示词 / 主题）。
 */
import {
  DefaultPackageManager,
  type SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { createLogger } from '../log';

const log = createLogger('packages');

const CATALOG_BASE = 'https://pi.dev/packages';
const PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = 15_000;
const VALID_TYPES = new Set(['extension', 'skill', 'prompt', 'theme']);
const PACKAGE_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

/** 社区目录条目（pi.dev 包目录卡片）。 */
export interface CatalogPackage {
  name: string;
  description: string;
  author: string;
  /** 贡献类型：extension / skill / prompt / theme / package。 */
  types: string[];
  downloads: number;
  updatedAt: number;
  /** pi 安装源（社区包固定 npm:）。 */
  installSource: string;
}

export interface CatalogSearchResult {
  packages: CatalogPackage[];
  total: number;
  page: number;
  pageSize: number;
}

/** 已配置（已安装）的包。 */
export interface ConfiguredPackageView {
  source: string;
  scope: 'user' | 'project';
  installedPath?: string;
}

export interface PiPackageServiceDeps {
  /** pi settings（与本机 runtime 共用实例，安装后内存态即时一致）。 */
  settingsManager: () => SettingsManager | null;
  cwd: () => string;
  agentDir: () => string;
  /** 装/卸成功后的热重载（装配层实现：非流式会话 reload）。 */
  onChanged: () => Promise<void> | void;
}

export class PiPackageService {
  private manager: DefaultPackageManager | null = null;

  constructor(private readonly deps: PiPackageServiceDeps) {}

  // ─── 社区目录 ───────────────────────────────────────────

  /** 搜索 pi.dev 社区包目录（服务端搜索 / 过滤 / 分页）。 */
  async searchCatalog(q: {
    query?: string;
    type?: string;
    page?: number;
  }): Promise<CatalogSearchResult> {
    const url = new URL(CATALOG_BASE);
    const query = q.query?.trim();
    if (query) url.searchParams.set('name', query);
    if (q.type && VALID_TYPES.has(q.type)) url.searchParams.set('type', q.type);
    const page = Math.max(1, Math.floor(q.page ?? 1));
    if (page > 1) url.searchParams.set('page', String(page));

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'work-studio',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`pi.dev 返回 HTTP ${res.status}`);
    const html = await res.text();
    const { packages, total } = parseCatalogHtml(html);
    return { packages, total, page, pageSize: PAGE_SIZE };
  }

  // ─── 安装 / 卸载 ────────────────────────────────────────

  listConfigured(): ConfiguredPackageView[] {
    return this.getManager()
      .listConfiguredPackages()
      .map((p) => ({
        source: p.source,
        scope: p.scope,
        ...(p.installedPath ? { installedPath: p.installedPath } : {}),
      }));
  }

  /** 安装社区包（npm:<name>，用户级），并热重载资源。 */
  async install(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!PACKAGE_NAME_RE.test(trimmed))
      throw new Error(`非法包名：${name}（npm 包名格式）`);
    try {
      await this.getManager().installAndPersist(`npm:${trimmed}`);
      log.info('package installed', trimmed);
    } catch (e) {
      throw new Error(normalizePackageError(e));
    }
    await this.deps.onChanged();
  }

  /** 卸载已配置的包（按 source + scope），并热重载资源。 */
  async remove(
    source: string,
    scope: 'user' | 'project',
  ): Promise<{ removed: boolean }> {
    try {
      const removed = await this.getManager().removeAndPersist(source, {
        local: scope === 'project',
      });
      if (removed) log.info('package removed', source, { scope });
      if (removed) await this.deps.onChanged();
      return { removed };
    } catch (e) {
      throw new Error(normalizePackageError(e));
    }
  }

  // ─── 内部 ───────────────────────────────────────────────

  private getManager(): DefaultPackageManager {
    if (this.manager) return this.manager;
    const settingsManager = this.deps.settingsManager();
    if (!settingsManager)
      throw new Error('pi runtime 尚未就绪：无法读写包配置');
    this.manager = new DefaultPackageManager({
      cwd: this.deps.cwd(),
      agentDir: this.deps.agentDir(),
      settingsManager,
      // 已知内置扩展（pi 内置名，供 `builtin:<name>` / `+builtin:<name>` 条目解析）
      builtinExtensions: ['mcp', 'llama.cpp', 'codemode', 'tool-search'],
    });
    return this.manager;
  }
}

/** npm 不在 PATH（GUI 启动环境常见）→ 给出可读错误。 */
function normalizePackageError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/(^|\b)spawn(\s+[^\s]+)*\s+npm(\.\w+)?\s+ENOENT\b/.test(message))
    return '未找到 npm（请安装 Node.js 并重启应用后再安装扩展）';
  return message;
}

// ─── 目录页解析（SSR HTML 卡片） ──────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function pick(html: string, pattern: RegExp): string {
  return pattern.exec(html)?.[1] ?? '';
}

/** 解析单张卡片 `<article data-package-card="true">…</article>`。 */
function parseCard(card: string): CatalogPackage | null {
  const name = pick(card, /data-package-name="([^"]+)"/);
  if (!name) return null;
  const typesRaw = pick(card, /data-package-types="([^"]*)"/);
  const types = typesRaw.trim().split(/\s+/).filter(Boolean);
  return {
    name,
    description: decodeHtmlEntities(
      pick(card, /<p class="packages-desc">([\s\S]*?)<\/p>/).trim(),
    ),
    author: pick(
      card,
      /<div class="packages-meta">\s*<span>([^<]*)<\/span>/,
    ).trim(),
    types: types.length > 0 ? types : ['package'],
    downloads: Number(pick(card, /data-package-downloads="(\d+)"/) || 0),
    updatedAt: Number(pick(card, /data-package-date="(\d+)"/) || 0),
    installSource: `npm:${name}`,
  };
}

/** 解析目录页：卡片列表 + 总数（分页文案 “1-50 / 5472”）。 */
export function parseCatalogHtml(html: string): {
  packages: CatalogPackage[];
  total: number;
} {
  const packages: CatalogPackage[] = [];
  const cardPattern =
    /<article[^>]*data-package-card="true"[\s\S]*?<\/article>/g;
  for (const m of html.matchAll(cardPattern)) {
    const pkg = parseCard(m[0]);
    if (pkg) packages.push(pkg);
  }
  const totalText = pick(html, /\d+-\d+\s*\/\s*([\d,]+)/);
  const total = totalText
    ? Number(totalText.replace(/,/g, ''))
    : packages.length;
  return { packages, total };
}
