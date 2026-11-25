/**
 * Live Dev —— live-dev 资源准备与连接（模式 = 系统提示状态）
 *
 * 只做一件事：维护一个带 CDP 的常驻 dev 窗口（WorkStudio），供调试/验证 attach。
 * 开启 = 扩展直接确保窗口就绪（在线复用 / 离线后台拉起并轮询到就绪）；
 * 关闭 = 扩展直接回收（杀进程、清临时文件）。全程不经 LLM，无额外对话轮次。
 *
 * 开发规则在同目录 rules.md，仅在模式开启期间追加进 system prompt
 * （before_agent_start 每轮重建，compaction 免疫；模式关闭即从上下文消失）。
 *
 * 入口：
 *   /dev            切换 live-dev 模式
 *   /dev on|off     显式开启/关闭（自动确保就绪 / 自动回收，均不经 LLM）
 *   /dev status     查看当前状态
 *   Ctrl+Alt+D      等同 /dev
 *   pi --dev        启动即进入模式
 *   live_dev 工具   供 LLM 在用户说「启动dev/结束开发」时调用（软入口桥）
 *   dev_shot 工具   截取 dev 窗口当前界面（CDP 截图，可先执行 JS 操作页面）
 *   dev_test 工具   在常驻 dev 窗口执行共享 e2e case（CDP，不启动 Playwright）
 *
 * 模式开启时：
 *   - system prompt 附加完整规则（rules.md）+ 本轮 dev 窗口状态
 *   - 状态栏显示模式与 dev 窗口（CDP 9222）在线状态
 *   - 守卫（弹确认框；无 UI 时直接拦截）仅一项：
 *       dev 窗口在线时重复拉起（重启流程——命令自带 kill+拉起，或实时探测已离线——自动放行）
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}/json/list`;
const IS_WIN = process.platform === 'win32';
/** 临时产物一律走系统 temp 目录：`/tmp` 在 Windows 上是「当前盘符根 + \\tmp」，未必存在。 */
const TMP_DIR = tmpdir();
const DEV_LOG = join(TMP_DIR, 'work-studio-dev.log');
const DEV_PID = join(TMP_DIR, 'work-studio-dev.pid');
const DEV_TEST_SHOT_PATH = join(TMP_DIR, 'work-studio-dev-test-failure.png');
const DEFAULT_SHOT_PATH = join(TMP_DIR, 'work-studio-shot.png');
const STATUS_KEY = 'live-dev';
const STATE_TYPE = 'live-dev-state'; // appendEntry 持久化（不进 LLM 上下文）
const LEGACY_STATE_TYPE = 'dev-mode-state'; // 兼容 rename 前的会话状态
const RULES_URL = new URL('./rules.md', import.meta.url);

interface DevModeState {
  enabled: boolean;
}

// rules.md 缺失/不可读时的最小内联回退
const FALLBACK_RULES = `# [LIVE DEV] Live Dev（回退规则，完整版 rules.md 读取失败）

dev 窗口（CDP 9222）的拉起与回收由扩展自动完成，无需管理其生命周期。
1. 复用唯一常驻 dev 窗口，绝不重复拉起；窗口离线时用 dev 工具恢复联通，无需询问。
2. 改 src/main.ts / preload 或依赖后直接重启窗口（kill + 拉起同条命令），无需确认。
3. 开发中只做本轮定向验证：pnpm typecheck + pnpm lint；页面改动用 dev_shot 工具截图目视。
4. 共享 e2e case 在 e2e/cases；开发时优先用 dev_test 执行单个 case，提交前用 pnpm test:e2e 跑 Playwright 隔离回归。
5. dev_test 只跑常驻窗口内的 case（tag=dev）；启动/重启/隔离类 case 由 Playwright 独享。`;

function loadRules(): string {
  try {
    const content = readFileSync(RULES_URL, 'utf-8').trim();
    return content.length > 0 ? content : FALLBACK_RULES;
  } catch {
    return FALLBACK_RULES;
  }
}

// ---------------------------------------------------------------------------
// 截图（dev_shot 工具）：CDP Page.captureScreenshot
// ---------------------------------------------------------------------------

interface CaptureResult {
  ok: boolean;
  path?: string;
  error?: string;
  target?: string;
}

interface CdpTarget {
  type: string;
  title?: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** 透明 / 空页窗口不产帧，Page.captureScreenshot 会永不回复——一律跳过。 */
const UNSHOTTABLE = /^(?:data:|about:blank|devtools:)/i;

/**
 * 候选 target，按优先级排序。
 *
 * 不能取 json/list 的第一个 page：覆盖层（透明窗、data: 空页）不出帧，截图命令永远等不到回复。
 * 优先：显式指定 → 主窗口（壳层）→ 其余可截页面；截不到时按此顺序往下试。
 */
function rankTargets(targets: CdpTarget[], hint?: string): CdpTarget[] {
  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      !UNSHOTTABLE.test(t.url) &&
      !/overlay/i.test(t.url) &&
      !/overlay/i.test(t.title ?? ''),
  );
  const ranked: CdpTarget[] = [];
  const take = (target?: CdpTarget): void => {
    if (target && !ranked.includes(target)) ranked.push(target);
  };
  if (hint) take(pages.find((t) => `${t.title ?? ''} ${t.url}`.includes(hint)));
  take(pages.find((t) => /(?:localhost|127\.0\.0\.1):\d+\/?$/.test(t.url)));
  take(pages.find((t) => t.url.startsWith('app://')));
  for (const page of pages) take(page);
  return ranked;
}

/** 对单个 target 跑一次 CDP 会话：enable → 可选 eval → 截图。 */
async function captureFromTarget(
  page: CdpTarget,
  outPath: string,
  evalScript?: string,
  waitMs = 300,
): Promise<CaptureResult> {
  const targetLabel = `${page.title || page.url}`;
  // 运行环境（Node ≥22 / Bun）自带全局 WebSocket
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => any })
    .WebSocket;
  if (!WebSocketCtor)
    return { ok: false, error: '当前运行环境无全局 WebSocket' };
  if (!page.webSocketDebuggerUrl)
    return { ok: false, error: `target 缺 WebSocket 地址（${targetLabel}）` };
  const ws = new WebSocketCtor(page.webSocketDebuggerUrl);
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  let seq = 0;
  ws.addEventListener('message', (event: { data: unknown }) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      error?: { message: string };
      result?: any;
    };
    if (msg.id != null && pending.has(msg.id)) {
      const entry = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    }
  });
  const opened = await new Promise<boolean>((resolve) => {
    ws.addEventListener('open', () => resolve(true), { once: true });
    ws.addEventListener('error', () => resolve(false), { once: true });
  });
  if (!opened) {
    return {
      ok: false,
      error: `CDP WebSocket 连接失败（target：${targetLabel}）`,
      target: targetLabel,
    };
  }
  /** 每条 CDP 命令都要有超时：页面不产帧时命令永不回复，无超时就是永久卡住。 */
  const send = (
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 8000,
  ): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`${method} 超时（${timeoutMs}ms，target：${targetLabel}）`),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  try {
    await send('Page.enable');
    if (evalScript) {
      const evaluated = await send('Runtime.evaluate', {
        expression: evalScript,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated?.exceptionDetails) {
        console.warn('[dev_shot] eval 异常：', evaluated.exceptionDetails.text);
      }
    }
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    const shot = (await send(
      'Page.captureScreenshot',
      { format: 'png' },
      15000,
    )) as { data: string };
    mkdirSync(dirname(outPath), { recursive: true }); // 输出目录可能不存在（自定义 path）
    writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    return { ok: true, path: outPath, target: targetLabel };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      target: targetLabel,
    };
  } finally {
    ws.close();
  }
}

/** 经 CDP 截取 dev 窗口页面到文件：按优先级试候选 target，首个成功即返回。 */
async function captureDevShot(
  outPath: string,
  evalScript?: string,
  waitMs = 300,
  hint?: string,
): Promise<CaptureResult> {
  const listRes = await fetch(CDP_URL, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  if (!listRes?.ok) return { ok: false, error: `CDP 未响应（${CDP_URL}）` };
  const candidates = rankTargets((await listRes.json()) as CdpTarget[], hint);
  if (candidates.length === 0)
    return { ok: false, error: '未找到可截图的页面 target' };
  const failures: string[] = [];
  for (const page of candidates.slice(0, 4)) {
    const result = await captureFromTarget(page, outPath, evalScript, waitMs);
    if (result.ok) return result;
    failures.push(result.error ?? '未知错误');
  }
  return { ok: false, error: failures.join('；') };
}

// ---------------------------------------------------------------------------
// 守卫判定（纯函数，便于测试）
// ---------------------------------------------------------------------------

interface Guard {
  title: string;
  question: string;
  reason: string;
}

/** 再拉起一个 dev 进程（pnpm dev / pnpm start / electron-vite dev；不含 dev:xxx 这类脚本名） */
function isStartDev(command: string): boolean {
  return (
    /(?:pnpm|npm|yarn|bun)(?:\.cmd|\.exe)?(?:\s+run)?\s+(?:dev|start)(?![\w:-])/.test(
      command,
    ) || /(?:electron-vite\s+dev|electron-forge\s+start)\b/.test(command)
  );
}

/** kill 类动作（POSIX pkill/killall/kill、Windows taskkill/Stop-Process）。与 isStartDev 同命令出现即「杀掉重拉」的重启流程 */
function isKillAction(command: string): boolean {
  return /\b(?:pkill|killall|kill|taskkill|Stop-Process)\b/i.test(command);
}

function classify(command: string, windowOnline: boolean): Guard | null {
  if (windowOnline && isStartDev(command)) {
    return {
      title: 'Dev 模式：重复拉起 dev 窗口',
      question:
        'dev 窗口（CDP 9222）当前在线，保持尽可能少的客户端：复用常驻窗口即可。允许再拉起一个 dev 进程吗？',
      reason:
        'live-dev 模式：dev 窗口已在线，直接复用（HMR 已生效），不要重复拉起客户端。',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// dev 状态文本与自定义 footer
// ---------------------------------------------------------------------------

/** 在线绿 / 离线红，颜色即语义 */
function devStatusText(theme: Theme, online: boolean): string {
  return online
    ? theme.fg('success', '● dev')
    : theme.fg('error', '○ dev 离线');
}

/** 以下三个格式化函数复刻自内置 footer（dist/modes/interactive/components/footer.js）
 *  ——pi 未从包根导出，只能本地拷贝。升级 pi 后如有出入属预期，见 renderDevFooter 注释。 */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === '' ||
    (relativeToHome !== '..' &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === '' ? '~' : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/**
 * 自定义 footer：复刻内置两行布局（pwd 行 + stats 行），唯一差异是
 * 扩展状态（含本扩展的 dev 状态，来自 setStatus）内联拼到 pwd 行尾，不单独占一行。
 *
 * 复刻来源同上（内置 FooterComponent.render）。两处无法完全对齐的内置细节：
 * - "(sub)" 订阅标识需要 modelRuntime（扩展不可达），略；
 * - " (auto)" 依赖 auto-compact 设置（扩展不可达），按默认值 true 显示。
 */
function renderDevFooter(
  width: number,
  ctx: ExtensionContext,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
): string[] {
  // ---- 行 1：cwd (+ branch + session name) + 扩展状态内联 ----
  // 不能用 HOME：Git-Bash / MSYS 下 HOME 是 /c/Users/x 这类非原生路径，resolve 后会算错
  let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), homedir());
  const branch = footerData.getGitBranch();
  if (branch) pwd = `${pwd} (${branch})`;
  const sessionName = ctx.sessionManager.getSessionName();
  if (sessionName) pwd = `${pwd} • ${sessionName}`;

  // 与内置 footer 的差异点：扩展状态拼在路径行尾（状态文本自带颜色，位于行尾不受外层 dim 影响）
  const statuses = Array.from(footerData.getExtensionStatuses().entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeStatusText(text));
  if (statuses.length > 0) pwd = `${pwd} ${statuses.join(' ')}`;
  const pwdLine = truncateToWidth(
    theme.fg('dim', pwd),
    width,
    theme.fg('dim', '...'),
  );

  // ---- 行 2：token / context 统计 ----
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  let latestCacheHitRate: number | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    const e = entry as {
      type: string;
      message?: {
        role: string;
        usage?: Record<string, any> & { cost?: { total: number } };
      };
      usage?: Record<string, any> & { cost?: { total: number } };
    };
    let usage: Record<string, any> | undefined;
    if (e.type === 'message' && e.message?.role === 'assistant') {
      usage = e.message!.usage;
    } else if (e.type === 'message' && e.message?.role === 'toolResult') {
      usage = e.message!.usage;
    } else if (e.type === 'branch_summary' || e.type === 'compaction') {
      usage = e.usage;
    }
    if (!usage) continue;
    totals.input += usage.input || 0;
    totals.output += usage.output || 0;
    totals.cacheRead += usage.cacheRead || 0;
    totals.cacheWrite += usage.cacheWrite || 0;
    totals.cost += usage.cost?.total || 0;
    if (e.type === 'message' && e.message?.role === 'assistant') {
      const promptTokens =
        (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
      latestCacheHitRate =
        promptTokens > 0
          ? ((usage.cacheRead || 0) / promptTokens) * 100
          : undefined;
    }
  }

  const contextUsage = ctx.getContextUsage();
  const model = ctx.model;
  const contextWindow =
    contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
  const contextPercentValue = contextUsage?.percent ?? 0;
  const contextPercent =
    contextUsage && contextUsage.percent !== null
      ? contextPercentValue.toFixed(1)
      : '?';

  const statsParts: string[] = [];
  if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
  if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
  if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
  if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
  if (
    (totals.cacheRead > 0 || totals.cacheWrite > 0) &&
    latestCacheHitRate !== undefined
  ) {
    statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
  }
  if (totals.cost) statsParts.push(`$${totals.cost.toFixed(3)}`);

  const contextPercentDisplay =
    contextPercent === '?'
      ? `?/${formatTokens(contextWindow)} (auto)`
      : `${contextPercent}%/${formatTokens(contextWindow)} (auto)`;
  let contextPercentStr: string;
  if (contextPercentValue > 90)
    contextPercentStr = theme.fg('error', contextPercentDisplay);
  else if (contextPercentValue > 70)
    contextPercentStr = theme.fg('warning', contextPercentDisplay);
  else contextPercentStr = contextPercentDisplay;
  statsParts.push(contextPercentStr);
  if (process.env.PI_EXPERIMENTAL === '1') {
    statsParts.push(
      `${theme.fg('dim', '•')} ${theme.bold(theme.fg('warning', 'xp'))}`,
    );
  }

  let statsLeft = statsParts.join(' ');
  let statsLeftWidth = visibleWidth(statsLeft);
  if (statsLeftWidth > width) {
    statsLeft = truncateToWidth(statsLeft, width, '...');
    statsLeftWidth = visibleWidth(statsLeft);
  }

  const minPadding = 2;
  const modelName = model?.id || 'no-model';
  let rightSideWithoutProvider = modelName;
  if (model?.reasoning) {
    const thinkingLevel = ctx.thinkingLevel || 'off';
    rightSideWithoutProvider =
      thinkingLevel === 'off'
        ? `${modelName} • thinking off`
        : `${modelName} • ${thinkingLevel}`;
  }
  let rightSide = rightSideWithoutProvider;
  if (footerData.getAvailableProviderCount() > 1 && model) {
    rightSide = `(${model.provider}) ${rightSideWithoutProvider}`;
    if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width)
      rightSide = rightSideWithoutProvider;
  }

  const rightSideWidth = visibleWidth(rightSide);
  const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;
  let statsLine: string;
  if (totalNeeded <= width) {
    const padding = ' '.repeat(width - statsLeftWidth - rightSideWidth);
    statsLine = statsLeft + padding + rightSide;
  } else {
    const availableForRight = width - statsLeftWidth - minPadding;
    if (availableForRight > 0) {
      const truncatedRight = truncateToWidth(rightSide, availableForRight, '');
      const truncatedRightWidth = visibleWidth(truncatedRight);
      const padding = ' '.repeat(
        Math.max(0, width - statsLeftWidth - truncatedRightWidth),
      );
      statsLine = statsLeft + padding + truncatedRight;
    } else {
      statsLine = statsLeft;
    }
  }

  const dimStatsLeft = theme.fg('dim', statsLeft);
  const remainder = statsLine.slice(statsLeft.length);
  const dimRemainder = theme.fg('dim', remainder);
  return [pwdLine, dimStatsLeft + dimRemainder];
}

// ---------------------------------------------------------------------------
// 扩展主体
// ---------------------------------------------------------------------------

export default function liveDevExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let windowOnline = false;
  let footerInstalled = false;
  let testSession: { isClosed(): boolean; close(): void } | undefined;

  // ---- dev 窗口探测 ------------------------------------------------------

  async function probeWindow(): Promise<boolean> {
    try {
      const res = await fetch(CDP_URL, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return false;
      const body = await res.text();
      // 就绪标志：json/list 含 localhost:5173（渲染层 dev server）或 WorkStudio
      return body.includes('localhost:5173') || body.includes('WorkStudio');
    } catch {
      return false; // 离线：连接拒绝/超时都是毫秒~1.5s 级
    }
  }

  async function refreshWindowState(ctx: ExtensionContext): Promise<boolean> {
    const online = await probeWindow();
    // 拉起轮询是 150ms 级：状态未变就不重写，避免 TUI 反复重绘
    if (online !== windowOnline) {
      windowOnline = online;
      updateStatus(ctx);
    }
    return online;
  }

  /** 拉起时记录的进程树根 pid（回收与重启清残留都靠它，不靠命令行匹配） */
  function readPid(): number | undefined {
    try {
      const pid = Number(readFileSync(DEV_PID, 'utf-8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 杀掉整棵 dev 进程树（electron-vite + Electron 主 + renderer + GPU + esbuild）。
   *
   * Windows 用 `taskkill /T`；POSIX 杀拉起时 `detached` 建出的进程组。
   * 回收也能兼作「清掉占着单实例锁的旧实例」：探活只能看到带 CDP 的窗口，
   * 一个没开 CDP 的 dev 实例（手动 pnpm dev、上次异常退出残留）拿不到锁会让新实例静默退出。
   */
  function killDev(): void {
    const pid = readPid();
    if (pid) {
      try {
        if (IS_WIN) {
          spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
            windowsHide: true,
          });
        } else {
          process.kill(-pid, 'SIGKILL');
        }
      } catch {
        /* 进程已退出：属预期 */
      }
    }
    rmSync(DEV_PID, { force: true });
  }

  /**
   * 兜底：清掉「不是本扩展拉起、却占着单实例锁」的 dev 实例（手工 `pnpm dev`、上次异常退出残留）。
   *
   * 探活只能看到带 CDP 的窗口，这种实例会抢走锁让新实例静默退出（表现为拉起超时）。
   * 按「命令行含本仓库路径 + electron」限定范围，不伤其他项目的 Electron。
   * 只在拉起超时后调一次，正常路径不付代价（Windows 上 PowerShell 查询约 0.5s）。
   */
  function killOrphanDev(cwd: string): void {
    try {
      if (IS_WIN) {
        const escaped = cwd.replace(/'/g, "''");
        const script =
          `Get-CimInstance Win32_Process | Where-Object { ` +
          `$_.ProcessId -ne $PID -and $_.Name -notmatch '^(powershell|pwsh)' -and ` +
          `$_.CommandLine -and $_.CommandLine.Contains('${escaped}') -and ` +
          `$_.CommandLine -match 'electron' } | ` +
          `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
        spawnSync(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 15_000 },
        );
      } else {
        const pattern = cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        spawnSync(
          'pkill',
          ['-9', '-f', `${pattern}/node_modules.*[Ee]lectron`],
          {
            timeout: 15_000,
          },
        );
      }
    } catch {
      /* 无匹配进程：属预期 */
    }
  }

  /** 后台拉起 `pnpm dev`（带 CDP 端口），pid 落盘供回收用 */
  function startDev(cwd: string): void {
    const log = openSync(DEV_LOG, 'w'); // 句柄直接交给子进程，不经过 shell 重定向
    const child = spawn('pnpm', ['dev'], {
      cwd,
      detached: true, // POSIX 建进程组（供 killDev 整组回收）
      shell: IS_WIN, // Windows 上 pnpm 是 .cmd，不能直接 spawn
      windowsHide: true,
      stdio: ['ignore', log, log], // 环境变量显式传递：Windows 没有 `env VAR=x cmd` 这种写法
      env: { ...process.env, WA_DEBUG_PORT: String(CDP_PORT) },
    });
    closeSync(log); // 子进程已继承，父进程这边立即关掉
    child.unref();
    if (child.pid) writeFileSync(DEV_PID, String(child.pid));
  }

  /** 确保窗口就绪：在线复用；离线则清残留后后台拉起，轮询到 CDP 就绪（最长约 60s） */
  async function ensureDevWindow(ctx: ExtensionContext): Promise<boolean> {
    if (await refreshWindowState(ctx)) return true;
    const cwd = ctx.sessionManager.getCwd();
    killDev(); // 无残留时为空操作
    startDev(cwd);
    let retried = false;
    // 前 12s 细粒度（150ms）抢冷启动尾巴，之后放粗；上限 60s（Windows 冷启动 + 杀软扫盘偏慢）
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, i < 80 ? 150 : 500));
      // 12s 仍未就绪：多半是另一个实例占着单实例锁（本扩展拉起的已由 killDev 处理）
      if (i === 80 && !retried) {
        retried = true;
        killOrphanDev(cwd);
        killDev();
        startDev(cwd);
      }
      if (await refreshWindowState(ctx)) return true;
    }
    return false;
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (!enabled) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, devStatusText(ctx.ui.theme, windowOnline));
  }

  // ---- 自定义 footer：扩展状态内联到路径行尾，不单独占一行 -----------------

  function installFooter(ctx: ExtensionContext): void {
    if (footerInstalled || !ctx.hasUI || ctx.mode !== 'tui') return;
    footerInstalled = true;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsubscribe,
        invalidate() {},
        render: (width: number) =>
          renderDevFooter(width, ctx, theme, footerData),
      };
    });
  }

  function uninstallFooter(ctx: ExtensionContext): void {
    if (!footerInstalled) return;
    footerInstalled = false;
    if (ctx.hasUI) ctx.ui.setFooter(undefined);
  }

  function notify(ctx: ExtensionContext, message: string): void {
    if (ctx.hasUI) ctx.ui.notify(message, 'info');
  }

  function persistState(): void {
    pi.appendEntry(STATE_TYPE, { enabled } satisfies DevModeState);
  }

  // ---- 关闭时直接回收资源（不经 LLM，无额外对话轮次） ----------------------

  /** 杀整棵 dev 进程树 + 清临时文件，返回 true 表示 CDP 已无响应（回收完成） */
  async function cleanupDevResources(_ctx: ExtensionContext): Promise<boolean> {
    killDev();
    // 给进程退出留时间（最多 2s），再确认连通性
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!(await probeWindow())) break;
    }
    rmSync(DEV_LOG, { force: true });
    windowOnline = await probeWindow();
    return !windowOnline;
  }

  function notifyOn(ctx: ExtensionContext, online: boolean): void {
    notify(
      ctx,
      online
        ? 'live-dev 模式已开启，dev 窗口已就绪（CDP 9222 在线）。'
        : `live-dev 模式已开启，但 dev 窗口拉起超时，详见 ${DEV_LOG}。`,
    );
  }

  function notifyOff(ctx: ExtensionContext, cleaned: boolean): void {
    notify(
      ctx,
      cleaned
        ? 'live-dev 模式已关闭，dev 资源已回收（窗口进程停止，CDP 9222 无响应）。'
        : 'live-dev 模式已关闭，但 CDP 9222 仍有响应，可能有残留进程（可重新 /dev off 重试，或自行结束占用 9222 端口的进程）。',
    );
  }

  // ---- 模式切换（命令与工具共用） ----------------------------------------

  async function setMode(
    on: boolean,
    ctx: ExtensionContext,
  ): Promise<{ changed: boolean; online: boolean; cleaned: boolean }> {
    const changed = enabled !== on;
    enabled = on;
    persistState();
    updateStatus(ctx); // 先按当前已知状态落一次（拉起期间显示「离线」）
    let online = windowOnline;
    let cleaned = false;
    if (on) {
      online = await ensureDevWindow(ctx); // 在线复用，离线自动拉起到就绪
      installFooter(ctx);
    } else {
      uninstallFooter(ctx);
      updateStatus(ctx);
      if (changed) cleaned = await cleanupDevResources(ctx); // 真正的 on→off 才回收
      online = windowOnline;
    }
    return { changed, online, cleaned };
  }

  function toggle(
    ctx: ExtensionContext,
  ): Promise<{ changed: boolean; online: boolean; cleaned: boolean }> {
    return setMode(!enabled, ctx);
  }

  // ---- 命令 / 快捷键 / CLI flag ------------------------------------------

  pi.registerCommand('dev', {
    description: 'live-dev 开发模式：切换（on/off/status）',
    getArgumentCompletions: (prefix) => {
      const all: Array<{ value: string; description: string }> = [
        { value: 'on', description: '开启模式并确保 dev 窗口就绪' },
        { value: 'off', description: '关闭模式并回收 dev 资源' },
        { value: 'status', description: '查看模式与 dev 窗口状态' },
      ];
      const hits = all
        .filter((o) => o.value.startsWith(prefix))
        .map((o) => ({
          value: o.value,
          label: o.value,
          description: o.description,
        }));
      return hits.length > 0 ? hits : null;
    },
    handler: async (args, ctx) => {
      const arg = (args ?? '').trim().toLowerCase();

      if (arg === 'status' || arg === '状态') {
        const online = enabled
          ? await refreshWindowState(ctx)
          : await probeWindow();
        notify(
          ctx,
          enabled
            ? `live-dev 模式：开启（dev 窗口${online ? '在线' : '离线'}）`
            : `live-dev 模式：关闭（dev 窗口${online ? '在线' : '离线'}）`,
        );
        return;
      }

      if (arg === '' || arg === 'toggle') {
        const { changed, online, cleaned } = await toggle(ctx);
        if (!changed) return;
        if (enabled) notifyOn(ctx, online);
        else notifyOff(ctx, cleaned);
        return;
      }

      if (arg === 'on' || arg === 'start' || arg === '启动' || arg === '开始') {
        const { changed, online } = await setMode(true, ctx);
        if (!changed) {
          notify(
            ctx,
            `已在 live-dev 模式中（dev 窗口${online ? '在线' : '离线'}）。`,
          );
          return;
        }
        notifyOn(ctx, online);
        return;
      }

      if (
        arg === 'off' ||
        arg === 'end' ||
        arg === 'stop' ||
        arg === '结束' ||
        arg === '关闭'
      ) {
        const { changed, cleaned } = await setMode(false, ctx);
        if (!changed) {
          notify(ctx, '当前不在 live-dev 模式中。');
          return;
        }
        notifyOff(ctx, cleaned);
        return;
      }

      notify(ctx, '用法：/dev [on|off|status]');
    },
  });

  pi.registerShortcut('ctrl+alt+d', {
    description: '切换 live-dev 模式',
    handler: async (ctx) => {
      const { changed, online, cleaned } = await toggle(ctx);
      if (!changed) return;
      if (enabled) notifyOn(ctx, online);
      else notifyOff(ctx, cleaned);
    },
  });

  pi.registerFlag('dev', {
    description: '启动即进入 live-dev 模式',
    type: 'boolean',
    default: false,
  });

  // ---- live_dev 工具：LLM 的软入口桥 --------------------------------------

  pi.registerTool({
    name: 'live_dev',
    label: 'Live Dev',
    description:
      '开启/关闭 live-dev 开发模式（dev 窗口资源准备与连接）。开启时扩展自动确保 dev 窗口就绪（CDP 9222），关闭时自动回收资源——两者均不经 LLM，无需执行任何拉起/清理命令。开发规则会注入系统提示。用户说「启动dev/开始开发」时用 action=on；「结束开发/关闭dev」时用 action=off。',
    promptSnippet: '开启/关闭 live-dev 开发模式（资源准备与回收全自动）',
    promptGuidelines: [
      '当用户要求进入或退出 live-dev 开发模式（如「启动 dev」「开始开发」「结束开发」「关闭 dev」）时，调用 live_dev 工具切换模式即可：开启后等待第一个开发需求（dev 窗口由扩展自动确保就绪）；关闭时资源回收由扩展自动完成。两种情况都不要执行拉起/清理命令，也不要向用户复述这些步骤。',
    ],
    parameters: Type.Object({
      action: StringEnum(['on', 'off'] as const),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === 'on') {
        const { changed, online } = await setMode(true, ctx);
        const text = changed
          ? online
            ? 'live-dev 模式已开启，dev 窗口已由扩展确保就绪（CDP 127.0.0.1:9222 在线，勿重复拉起）。开发规则已注入系统提示 [LIVE DEV] 部分，等待第一个开发需求即可。'
            : `live-dev 模式已开启，但 dev 窗口拉起超时（日志：${DEV_LOG}）。可先开始不受影响的工作，或按 [LIVE DEV] 规则自行恢复联通。`
          : `live-dev 模式已处于开启状态（dev 窗口${online ? '在线' : '离线'}），无需重复开启。`;
        return {
          content: [{ type: 'text', text }],
          details: { enabled: true, online },
        };
      }

      const { changed, cleaned } = await setMode(false, ctx);
      const text = changed
        ? cleaned
          ? 'live-dev 模式已关闭，dev 资源已由扩展直接回收（窗口进程停止、临时文件已清理、CDP 9222 无响应）。无需任何收尾操作，向用户简报一句即可。'
          : 'live-dev 模式已关闭，回收已执行，但 CDP 9222 仍有响应——可能存在残留进程（可重新 /dev off 重试，或自行结束占用 9222 端口的进程）。除告知用户外无需其他收尾操作。'
        : 'live-dev 模式当前未开启，无需关闭。';
      return {
        content: [{ type: 'text', text }],
        details: { enabled: false, cleaned },
      };
    },
  });

  // ---- dev_test 工具：在常驻窗口执行共享 e2e case ---------------------------

  async function getTestSession(cwd: string): Promise<{
    runCdpFilter: (
      filter: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<
      Array<{
        id: string;
        title: string;
        ok: boolean;
        error?: string;
        screenshot?: string;
      }>
    >;
    session: { isClosed(): boolean; close(): void };
  }> {
    const moduleUrl = pathToFileURL(resolve(cwd, 'e2e/runner/run.ts')).href;
    const runner = (await import(moduleUrl)) as {
      runCdpFilter: (
        filter: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => Promise<
        Array<{
          id: string;
          title: string;
          ok: boolean;
          error?: string;
          screenshot?: string;
        }>
      >;
    };
    const cdp = (await import(
      pathToFileURL(resolve(cwd, 'e2e/runner/cdp.ts')).href
    )) as {
      CdpSession: {
        connectShell(): Promise<{ isClosed(): boolean; close(): void }>;
      };
    };
    if (!testSession || testSession.isClosed()) {
      testSession = await cdp.CdpSession.connectShell();
    }
    return { runCdpFilter: runner.runCdpFilter, session: testSession };
  }

  pi.registerTool({
    name: 'dev_test',
    label: 'Dev E2E',
    description:
      '在常驻 dev 窗口（CDP 9222）执行共享 e2e 用例，不启动 Playwright。可按 case id / tag / grep 过滤；默认跑 tag=dev 的用例。失败返回截图路径。启动/重启/隔离类用例由 Playwright 独享，这里不会执行。',
    promptSnippet: '在常驻 dev 窗口执行共享 e2e 用例（CDP，不启动 Playwright）',
    promptGuidelines: [
      "开发中改完 UI 或交互后，优先调用 dev_test 执行相关 case（如 dev_test({ case: 'resource.open' })）；不要为单个 case 启动 Playwright。",
      'dev_test 失败时会返回截图和错误；先看截图与 DOM 断言，再修复。提交前再跑 pnpm test:e2e 做 Playwright 隔离回归。',
      '启动/重启/隔离/打包类用例标记为 playwright-only，不要用 dev_test 跑。',
    ],
    parameters: Type.Object({
      case: Type.Optional(
        Type.String({ description: 'case id，例如 resource.open' }),
      ),
      tag: Type.Optional(StringEnum(['dev', 'ci'] as const)),
      grep: Type.Optional(
        Type.String({ description: '按 id/title 包含的文本过滤' }),
      ),
      all: Type.Optional(
        Type.Boolean({ description: '跑全部 dev 可执行 case' }),
      ),
      allowMutating: Type.Optional(
        Type.Boolean({
          description: '允许执行标记 mutating 的 case（默认拒绝）',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!(await refreshWindowState(ctx))) {
        return {
          content: [
            {
              type: 'text',
              text: 'dev 窗口离线；dev_test 不负责启动/重启，请先恢复 dev 窗口（扩展会在 dev 模式开启时自动拉起）。',
            },
          ],
          details: undefined,
        };
      }
      const cwd = ctx.sessionManager.getCwd();
      try {
        const { runCdpFilter, session } = await getTestSession(cwd);
        const filter = {
          id: params.case,
          tag: params.tag ?? (params.all ? undefined : 'dev'),
          grep: params.grep,
          all: params.all,
        };
        const results = await runCdpFilter(filter, {
          allowMutating: params.allowMutating === true,
          screenshotPath: DEV_TEST_SHOT_PATH,
          session,
        });
        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: '没有匹配的 dev case。可用 case 见 e2e/runner/registry.ts。',
              },
            ],
            details: undefined,
          };
        }
        const lines = results.map((result) =>
          result.ok
            ? `✓ ${result.id}  ${result.title}`
            : `✗ ${result.id}  ${result.title}\n  ${result.error}\n  截图：${result.screenshot ?? '无'}`,
        );
        const failed = results.filter((result) => !result.ok).length;
        lines.push(`\n${results.length - failed} passed, ${failed} failed`);
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { results },
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `dev_test 执行失败：${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: undefined,
        };
      }
    },
  });

  // ---- dev_shot 工具：截图能力（内置于扩展，无外部脚本） --------------------

  pi.registerTool({
    name: 'dev_shot',
    label: 'Dev Screenshot',
    description:
      '截取 dev 窗口当前界面为 PNG（经 CDP 9222），可先执行 JS 操作页面再截图。截图前先探测窗口；离线时直接返回状态，不拉起窗口、不等待。返回保存路径，用 read 查看图片。',
    promptSnippet: '截取 dev 窗口当前界面（CDP 截图，可预操作页面）',
    promptGuidelines: [
      '改完 UI 需要目视验证时，调用 dev_shot 工具截图（可用 eval 参数先点击/切状态，waitMs 等渲染），再 read 保存的 PNG 查看。不要另写截图脚本。',
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: `输出路径（相对路径按工作目录解析）；默认 ${DEFAULT_SHOT_PATH}`,
        }),
      ),
      eval: Type.Optional(
        Type.String({
          description:
            '截图前在页面执行的 JS（支持 async，await 完成后才截图）',
        }),
      ),
      waitMs: Type.Optional(
        Type.Number({
          description: '执行 JS 后额外等待毫秒数（等渲染），默认 300',
        }),
      ),
      target: Type.Optional(
        Type.String({
          description:
            '目标页面标题或 URL 片段（默认主窗口；可指向设置页 / 插件页 / 助手）',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // 截图不做拉起：窗口没开就直接返回状态，避免等待与意外启动。
      if (!(await refreshWindowState(ctx))) {
        return {
          content: [
            {
              type: 'text',
              text: `dev 窗口离线（CDP ${CDP_PORT} 未响应）；dev_shot 不负责拉起，需要时先启动 dev 窗口。`,
            },
          ],
          details: undefined,
        };
      }
      const outPath = resolve(
        ctx.sessionManager.getCwd(),
        params.path ?? DEFAULT_SHOT_PATH,
      );
      const result = await captureDevShot(
        outPath,
        params.eval,
        params.waitMs,
        params.target,
      );
      return result.ok
        ? {
            content: [
              {
                type: 'text',
                text: `已截图：${result.path}（${result.target}｜用 read 查看）`,
              },
            ],
            details: { path: result.path, target: result.target },
          }
        : {
            content: [{ type: 'text', text: `截图失败：${result.error}` }],
            details: undefined,
          };
    },
  });

  // ---- 守卫：仅拦截「窗口在线时重复拉起」（重启流程直接放行） ----------------

  pi.on('tool_call', async (event, ctx) => {
    if (!enabled || event.toolName !== 'bash') return;
    if (!isToolCallEventType('bash', event)) return;

    const command = event.input.command ?? '';

    // start-dev 判定不能用缓存的窗口状态（turn 开始时探测的）：
    // 重启流程中窗口可能刚被上一条命令杀掉，缓存仍显示在线。
    // - 命令自带 kill + 拉起：一条命令内完成重启，直接放行，不弹确认；
    // - 纯拉起命令：实时探测窗口，离线则放行（恢复联通），确实在线才弹确认。
    let effectiveOnline = windowOnline;
    if (isStartDev(command)) {
      effectiveOnline = isKillAction(command) ? false : await probeWindow();
      if (effectiveOnline !== windowOnline) {
        windowOnline = effectiveOnline;
        updateStatus(ctx);
      }
    }

    const guard = classify(command, effectiveOnline);
    if (!guard) return;

    if (!ctx.hasUI) {
      return { block: true, reason: guard.reason };
    }
    const ok = await ctx.ui.confirm(guard.title, guard.question);
    if (!ok) return { block: true, reason: guard.reason };
  });

  // ---- 每轮把完整规则追加进 system prompt（compaction 免疫，模式关闭即消失） --

  pi.on('before_agent_start', async (event, ctx) => {
    if (!enabled) return;
    installFooter(ctx); // 兜底：/resume 恢复模式时 UI 可能晚于 session_start 就绪
    await refreshWindowState(ctx);
    const rules = loadRules();
    const block =
      `[LIVE DEV ACTIVE — 以下为 live-dev 开发模式完整规则，硬性遵守]\n\n` +
      `${rules}\n\n` +
      `[LIVE DEV 状态] dev 窗口（CDP 127.0.0.1:9222）：` +
      `${windowOnline ? '在线——复用，勿重复拉起' : '离线——需要时拉起保持联通'}（此后以你的工具调用结果为准）`;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${block}`,
    };
  });

  // 模式内每个 turn 刷新窗口探测（捕捉「本轮内拉起/杀掉窗口」后的状态变化）
  pi.on('turn_start', async (event, ctx) => {
    if (!enabled || event.turnIndex === 0) return; // 第 0 轮已由 before_agent_start 探测
    await refreshWindowState(ctx);
  });

  // ---- 会话恢复 -----------------------------------------------------------

  pi.on('session_start', async (_event, ctx) => {
    // 1) 恢复持久化状态（/resume、/fork）
    const entries = ctx.sessionManager.getEntries();
    const stateEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === 'custom' &&
          (e.customType === STATE_TYPE || e.customType === LEGACY_STATE_TYPE),
      )
      .pop() as { data?: DevModeState } | undefined;
    if (stateEntry?.data && typeof stateEntry.data.enabled === 'boolean') {
      enabled = stateEntry.data.enabled;
    }
    // 2) 显式 CLI flag 优先
    if (pi.getFlag('dev') === true) {
      enabled = true;
    }
    if (enabled) {
      installFooter(ctx);
      const online = await ensureDevWindow(ctx);
      notify(
        ctx,
        `live-dev 模式已恢复（dev 窗口${online ? '在线' : '离线'}）。`,
      );
    }
  });
}
