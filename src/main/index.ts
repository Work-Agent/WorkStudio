/**
 * L3 装配（README.md §四）—— 应用生命周期、窗口、域服务装配、IPC 注册。
 *
 * 启动链：
 *   agentDir → 工作区 → 插件扫描 → 资源网关 → UiState → AgentHost → ViewHost
 *   → 命令路由 / 原生设施 → 主窗口 → 视图恢复与系统视图
 *
 * 规则：IPC 注册先于建窗；AgentHost 先于 ViewHost（视图内容投递依赖会话与资源就绪）。
 */
import {
  app,
  BrowserWindow,
  Menu,
  net,
  protocol,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TITLEBAR_HEIGHT, TITLEBAR_OVERLAY_COLORS } from '../shared/titlebar';
import { fileRef } from '../shared/ura';
import type { AppCommand } from '../shared/app';
import type { Rect, UiState } from '../shared/types';
import {
  APP_CMD,
  APP_EVENT,
  APP_SNAPSHOT,
  APP_SYNC,
  CH_BUS,
  CH_RESOURCES,
  CH_URA,
  CH_URA_WATCH,
} from '../shared/channels';
import { AgentHost } from './agent/agent-host';
import { ModelConfigStore } from './agent/config-service';
import { PiPackageService } from './agent/package-service';
import { PluginService } from './plugins/service';
import { PluginCatalogService } from './plugins/catalog';
import {
  ensureDefaultWorkspace,
  getAgentDir,
  getCurrentWorkspace,
  getSessionsDir,
  getWorkspaceBase,
  getWorkspaceId,
  getWorkspaceResourcesDir,
  initAgentDir,
  listWorkspaces,
  registerWorkspace,
} from './agent/workspace';
import { SkillsManager } from './harness/skills';
import { createUraRuntime, type UraRuntime } from './ura';
import { WriteSessionRegistry } from './ura/sessions';
import { PageSessions } from './ura/page-sessions';
import { SiteSnapshots } from './capabilities/browser/snapshots';
import { containsSettingsPage } from './capabilities/settings/registry';
import { UiStateService } from './state/ui-state';
import { broadcastToWindows } from './state/broadcast';
import {
  classifySender,
  invoke,
  isAssistantCommand,
  registerRouter,
  type RouterDeps,
} from './command/router';
import { InteractionController } from './capabilities/webview/interaction';
import { NativeFacilities } from './capabilities/webview/native-facilities';
import { BrowserAutomation } from './capabilities/browser/views';
import { ViewHost } from './capabilities/webview/host';
import { AppHost } from './app/app-host';
import { buildAppSnapshot } from './app/snapshot';
import { WorkspaceManager } from './app/workspace-manager';
import { WorkspaceScope } from './app/workspace-scope';
import { SessionAdapter } from './app/session-adapter';
import { ListService } from './app/lists/list-service';
import { computeLayout } from '../shared/layout-engine';
import { preloadPath } from './capabilities/webview/presets';
import { createLogger } from './log';
import { mainDir, rendererFile } from './paths';

const log = createLogger('main');
const isDev = !app.isPackaged;

/**
 * 启动诊断日志（<userData>/boot.log，每次启动重建）。
 * 打包后主进程 stdout 不可见，启动期故障靠这份日志定位（也便于用户反馈）。
 */
const bootLogFile = path.join(app.getPath('userData'), 'boot.log');
try {
  writeFileSync(bootLogFile, '');
} catch {
  /* ignore */
}
function bootLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    appendFileSync(bootLogFile, line);
  } catch {
    /* ignore */
  }
  log.info(message);
}
process.on('uncaughtException', (e) =>
  bootLog(`uncaughtException: ${e?.stack ?? String(e)}`),
);
process.on('unhandledRejection', (e) =>
  bootLog(
    `unhandledRejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  ),
);
bootLog(
  `boot: packaged=${app.isPackaged} pid=${process.pid} cwd=${process.cwd()}`,
);

// live-dev（.pi/extensions/dev-mode）：WA_DEBUG_PORT 时开放 CDP。
if (
  process.env['WA_DEBUG_PORT'] &&
  /^\d+$/.test(process.env['WA_DEBUG_PORT'])
) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env['WA_DEBUG_PORT'],
  );
  console.log(
    `[live-dev] CDP listening on 127.0.0.1:${process.env['WA_DEBUG_PORT']}`,
  );
}

/** 页面协议：app://page/<绝对路径>（插件页与设置页共用；标准 + secure，生产不从 file:// 直开）。 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

/**
 * app:// 处理器（纯函数：请求 → 响应）。
 * 协议处理器是 **session 级** 注册：每个 partition（插件页各有独立 partition）
 * 都要注册一份，否则视图加载会 ERR_FAILED。
 */
function handleAppRequest(request: Request): Response | Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'page')
      return new Response('Not found', { status: 404 });
    const file = decodeURIComponent(url.pathname).replace(/^\/+/, '/');
    if (!file.startsWith('/'))
      return new Response('Not found', { status: 404 });
    if (!uraRuntime?.host.containsPage(file) && !containsSettingsPage(file))
      return new Response('Forbidden', { status: 403 });
    if (!existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  } catch (e) {
    log.error('app:// handler failed', e);
    return new Response('Internal error', { status: 500 });
  }
}

/** session → 已注册标记（同一 session 只注册一次）。 */
const appProtocolSessions = new WeakSet<Electron.Session>();

/** 注册 app:// 到指定 session（幂等）。渲染层与每个原生视图 partition 各一份。 */
function registerAppProtocol(sessionRef: Electron.Session): void {
  if (appProtocolSessions.has(sessionRef)) return;
  appProtocolSessions.add(sessionRef);
  sessionRef.protocol.handle('app', (request) => handleAppRequest(request));
}

// ─── 全局单例 ─────────────────────────────────────────────

const skills = new SkillsManager();
const uiState = new UiStateService();
const nativeFacilities = new NativeFacilities();

let winRef: BrowserWindow | null = null;
let agent: AgentHost | null = null;
let viewHost: ViewHost | null = null;
let appHost: AppHost | null = null;
let workspaceManager: WorkspaceManager | null = null;
let interaction: InteractionController | null = null;
let uraRuntime: UraRuntime | null = null;
let workspaceWatcher: { close(): void } | null = null;
let modelConfig: ModelConfigStore | null = null;
let packageService: PiPackageService | null = null;
let pluginService: PluginService | null = null;
let pluginCatalog: PluginCatalogService | null = null;
let browserAutomation: BrowserAutomation | null = null;
let workspacePath = '';
/** 运行期浮动助手几何（瞬时，不落盘）。 */
let floatingGeometry: Rect | null = null;
/** 页面视口（渲染层上报；docked DevTools 时小于窗口，原生视图据此让位）。 */
let viewportSize: { width: number; height: number } | null = null;

// ─── 布局快照 ─────────────────────────────────────────────

function windowSize(): { width: number; height: number } {
  const win = winRef;
  if (!win || win.isDestroyed()) return { width: 1440, height: 900 };
  const bounds = win.getContentBounds();
  return { width: bounds.width, height: bounds.height };
}

function buildLayout() {
  const size = windowSize();
  return computeLayout({
    windowWidth: size.width,
    windowHeight: size.height,
    ui: uiState.get(),
    floating: floatingGeometry,
    preview: interaction?.getPreview() ?? null,
    viewport: viewportSize,
  });
}

function applyLayout(): void {
  viewHost?.applyLayout();
}

/** Shell 快照唯一广播出口：主窗口 + 系统视图（助手 / overlay）。 */
function broadcastState(): void {
  publishAppSnapshot();
}

function broadcastViews(): void {
  publishAppSnapshot();
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function publishAppSnapshot(): void {
  if (!appHost) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void appHost?.snapshot().then((snapshot) => {
      broadcastToWindows(APP_SNAPSHOT, snapshot);
      viewHost?.broadcastToSystemViews(APP_SNAPSHOT, snapshot);
    });
  }, 60);
}

// ─── 主窗口 ───────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const theme = uiState.get().theme;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: theme === 'light' ? '#f4f4f5' : '#1a1c1d',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 12 } }
      : {
          titleBarOverlay: {
            ...(theme === 'light'
              ? TITLEBAR_OVERLAY_COLORS.light
              : TITLEBAR_OVERLAY_COLORS.dark),
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: preloadPath('workbench'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('resize', () => {
    applyLayout();
    broadcastState();
  });
  win.on('closed', () => {
    if (winRef === win) winRef = null;
  });

  if (isDev) {
    win.webContents.on('console-message', (event) => {
      const { level, message, lineNumber, sourceId } = event as unknown as {
        level: number;
        message: string;
        lineNumber?: number;
        sourceId?: string;
      };
      const tag = ['LOG', 'WARN', 'ERROR'][level] ?? 'LOG';
      console.log(
        `[renderer:${tag}] ${message} (${sourceId ?? ''}:${lineNumber ?? 0})`,
      );
    });
  }

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) void win.loadURL(devServer);
  else void win.loadFile(rendererFile('index.html'));

  if (process.env['WA_DEVTOOLS'] === '1') win.webContents.openDevTools();
  return win;
}

/**
 * 应用菜单（macOS 必需；Windows/Linux 也统一）。
 *
 * 关键：DevTools 必须 `mode: 'detach'` —— docked 的 DevTools 属于窗口 DOM，
 * 会被原生 WebContentsView 整个盖住（看起来“点了没反应”）。
 */
function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: '重载当前视图',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const id = viewHost?.getActiveId();
            if (id) viewHost?.reload(id);
          },
        },
        {
          label: '开发者工具',
          accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            const wc = winRef?.webContents;
            if (!wc || wc.isDestroyed()) return;
            // 浏览器语义：右侧停靠；原生视图按“页面视口”收缩（见 debug.viewport）。
            if (wc.isDevToolsOpened()) wc.closeDevTools();
            else wc.openDevTools({ mode: 'right' });
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  const view = template.find((item) => item.label === 'View');
  const labels = Array.isArray(view?.submenu)
    ? view.submenu
        .map((item) => item.label ?? item.role ?? item.type)
        .join(' / ')
    : '(n/a)';
  bootLog(`app menu ready: View = ${labels}`);
}

/** 全局快捷键（焦点在任意视图内都生效）：Cmd+W / Cmd+1..9。 */
function registerShortcuts(): void {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.meta || input.control;
      if (!mod || input.alt) return;
      const host = viewHost;
      if (!host) return;
      if (input.key.toLowerCase() === 'w') {
        event.preventDefault();
        const active = host.getActiveId();
        if (active) host.close(active);
        return;
      }
      const digit = Number.parseInt(input.key, 10);
      if (!Number.isNaN(digit) && digit >= 1 && digit <= 9) {
        const list = host.list();
        const target = list[digit - 1];
        if (target) {
          event.preventDefault();
          host.activate(target.id);
        }
      }
    });
  });
}

// ─── App 作用域 IPC ───────────────────────────────────────

function registerAppIpc(deps: RouterDeps): void {
  ipcMain.handle(APP_SYNC, (event) => {
    const type = classifySender(event, deps);
    if (type === 'unknown' || type === 'view') {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'App sync is not allowed' },
      };
    }
    return appHost!.snapshot();
  });
  ipcMain.handle(APP_CMD, (event, command: AppCommand) => {
    const type = classifySender(event, deps);
    if (type === 'unknown' || type === 'view') {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed from this sender`,
        },
      };
    }
    if (type === 'assistant' && !isAssistantCommand(command.action)) {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed for the assistant view`,
        },
      };
    }
    if (type === 'overlay' && command.action !== 'ui.respond') {
      return {
        ok: false,
        error: {
          code: 'forbidden',
          message: `Command "${command.action}" is not allowed for the overlay view`,
        },
      };
    }
    return appHost!.dispatch(command);
  });
}

// ─── 装配 ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  bootLog('whenReady');
  // 1. agentDir + 工作区（首装引导）
  initAgentDir(path.join(app.getPath('userData'), 'agent'));
  if (listWorkspaces().length === 0) {
    ensureDefaultWorkspace(app.getPath('documents'));
  }
  workspacePath = getCurrentWorkspace();
  const wsId = registerWorkspace(workspacePath);
  bootLog(`workspace: ${workspacePath} (${wsId})`);

  // 2.5 URA（资源管道 + 插件包）
  pluginService = new PluginService({
    root: path.join(app.getPath('userData'), 'plugins'),
    file: path.join(app.getPath('userData'), 'plugins', 'registry.md'),
    cwd: () => workspacePath,
  });
  await pluginService.start();
  pluginCatalog = new PluginCatalogService({
    cacheFile: path.join(app.getPath('userData'), 'plugin-catalog.md'),
    urlFile: path.join(app.getPath('userData'), 'plugin-catalog-url.txt'),
  });
  await pluginCatalog.start();
  uraRuntime = await createUraRuntime({
    dataRoot: path.join(app.getPath('userData'), 'plugin-data'),
    bindingFile: path.join(app.getPath('userData'), 'ura-bindings.json'),
    workspace: () => workspacePath,
    pluginRoots: [
      ...pluginService.roots(),
      path.join(app.getAppPath(), 'src', 'plugins'),
      path.join(mainDir, '..', 'plugins'),
    ],
  });
  bootLog(
    `ura ready: plugins=${
      uraRuntime.host
        .list()
        .map((p) => p.id)
        .join(',') || '(none)'
    }`,
  );
  const pageSessions = new PageSessions(uraRuntime.ura);
  const writeSessions = new WriteSessionRegistry(uraRuntime.ura);

  // 3. 工作区订阅（URA watch → 渲染层刷新）
  const watchWorkspaceRoot = (): void => {
    workspaceWatcher?.close();
    workspaceWatcher = uraRuntime!.ura.watch(
      fileRef(workspacePath),
      (event) => {
        broadcastToWindows(CH_URA, event);
        broadcastViews();
      },
    );
  };
  watchWorkspaceRoot();
  bootLog('workspace watch ready');

  // 4. UiState（真相源 + 主题收敛）
  uiState.attachWindowSource(() => winRef);
  uiState.attachStateBroadcaster(() => broadcastState());
  uiState.registerQuitFlush();
  uiState.attachWorkspace(wsId);

  // 启动收敛：打开集合只保留仍存在的会话文件（外部删除 / 旧现场不留幽灵标签）
  {
    const ui = uiState.get();
    const openPaths = ui.openPaths.filter((p) => existsSync(p));
    const activePath =
      ui.activePath && openPaths.includes(ui.activePath)
        ? ui.activePath
        : (openPaths[0] ?? null);
    if (
      openPaths.length !== ui.openPaths.length ||
      activePath !== ui.activePath
    )
      uiState.set({ openPaths, activePath });
  }

  // 6. ViewHost（原生视图层）
  viewHost = new ViewHost({
    getWindow: () => winRef,
    plugins: uraRuntime.host,
    pageSessions,
    uiState,
    workspaceId: () => getWorkspaceId(workspacePath),
    getLayout: buildLayout,
    broadcastState,
    broadcastView: broadcastViews,
    broadcastBus: (viewId, message) =>
      broadcastToWindows(CH_BUS, { viewId, message }),
    openExternal: (url) => void shell.openExternal(url),
    ensureAppProtocol: (partition) =>
      registerAppProtocol(session.fromPartition(partition)),
  });

  browserAutomation = new BrowserAutomation(viewHost);

  // 5. AgentHost（pi runtime + 自有 harness）
  modelConfig = new ModelConfigStore(getAgentDir());
  bootLog('agent: bootstrapping');
  agent = await AgentHost.bootstrap(
    {
      ura: uraRuntime.ura,
      skills,
      registry: uraRuntime.host,
      getBrowserAutomation: () => browserAutomation,
      sendEvent: (frame) => {
        const appEvent = {
          scope: 'session' as const,
          epoch: appHost?.epochs.session ?? 0,
          seq: frame.seq,
          event: frame.event,
        };
        broadcastToWindows(APP_EVENT, appEvent);
        viewHost?.broadcastToSystemViews(APP_EVENT, appEvent);
        publishAppSnapshot();
      },
      onTurnFinished: () => {
        broadcastToWindows('documents:changed');
        broadcastToWindows(CH_RESOURCES, { type: 'turn-finished' });
        agent?.emitStatus();
      },
      onSessionCreated: (path) => {
        const ui = uiState.get();
        const openPaths = ui.openPaths.includes(path)
          ? ui.openPaths
          : [...ui.openPaths, path];
        uiState.set({ openPaths, activePath: path });
      },
      onWorkspaceChange: (next) => {
        workspacePath = next;
        const nextWsId = registerWorkspace(next);
        watchWorkspaceRoot();
        uraRuntime?.map.restart();
        if (viewHost && workspaceManager) {
          workspaceManager.activate(
            new WorkspaceScope({
              path: next,
              id: nextWsId,
              uiState,
              viewHost,
              pageSessions,
              writeSessions,
            }),
          );
          appHost?.bumpWorkspace();
          appHost?.bumpSession();
          broadcastState();
          broadcastViews();
        } else {
          uiState.attachWorkspace(nextWsId);
        }
      },
      ui: {
        onDialogRequest: (req) => viewHost?.showDialog(req),
        onDialogResolved: (id) => viewHost?.resolveDialog(id),
        onNotify: (message, level, source) =>
          viewHost?.sendUiToWorkbench({
            type: 'notify',
            id: `n-${Date.now()}`,
            message,
            level,
            source,
          }),
      },
      openExternal: (url) => void shell.openExternal(url),
    },
    workspacePath,
  );

  bootLog('agent: ready');

  // 5.5 pi 包服务（社区目录 / 安装 / 卸载；装后热重载资源）
  packageService = new PiPackageService({
    settingsManager: () => agent?.settingsManager ?? null,
    cwd: () => workspacePath,
    agentDir: () => getAgentDir(),
    onChanged: () => agent?.reloadResources(),
  });

  interaction = new InteractionController({
    getWindow: () => winRef,
    viewHost,
    uiState,
    getLayout: buildLayout,
    getFloating: () => floatingGeometry,
    setFloating: (rect) => {
      floatingGeometry = rect;
    },
    broadcastState,
    applyLayout,
  });

  // 7. URA 订阅（页面侧 watch / unwatch）
  {
    const watchers = new Map<number, { close(): void }>();
    ipcMain.handle(CH_URA_WATCH, (event, ref?: string) => {
      const id = event.sender.id;
      watchers.get(id)?.close();
      watchers.delete(id);
      if (!ref) return null;
      const handle = uraRuntime!.ura.watch(String(ref), (change) => {
        if (!event.sender.isDestroyed()) event.sender.send(CH_URA, change);
      });
      watchers.set(id, handle);
      event.sender.once('destroyed', () => {
        handle.close();
        watchers.delete(id);
      });
      return { ref: String(ref) };
    });
  }

  const listService = new ListService({
    contexts: uraRuntime!.contexts,
    agent: agent!,
    plugins: uraRuntime!.host,
    viewHost: viewHost!,
  });

  uraRuntime!.map.setSource(async () => {
    const snapshot = await listService.snapshot(0);
    return snapshot.groups
      .filter((group) => group.section === 'resources')
      .map((group) => ({
        label: group.label,
        items: group.items
          .map((item) => ({
            ref: String(item.meta?.['ref'] ?? ''),
            title: item.title,
          }))
          .filter((item) => item.ref),
      }))
      .filter((group) => group.items.length > 0);
  });
  uraRuntime!.map.restart();

  const sessionAdapter = new SessionAdapter({
    agent: agent!,
    skills,
    defaultSkills: () => uiState.get().selectedSkills,
    onChanged: () => {
      appHost?.bumpSession();
      broadcastState();
    },
  });

  // 7. 命令路由 / 原生设施
  const routerDeps: RouterDeps = {
    agent,
    sessions: sessionAdapter,
    lists: listService,
    viewHost,
    uiState,
    ura: uraRuntime.ura,
    writeSessions,
    pageSessions,
    skills,
    registry: uraRuntime.host,
    modelConfig,
    packages: packageService,
    pluginSources: pluginService,
    pluginCatalog: pluginCatalog,
    getSettingsService: () => agent!.settingsService,
    interaction,
    getWindow: () => winRef,
    applyLayout,
    setViewport: (size) => {
      viewportSize = size;
      applyLayout();
      // 视口变化会改变全部 layout 矩形（DOM 区域与原生视图同源），必须广播收敛。
      broadcastState();
    },
    browserCapture: async () => {
      if (!browserAutomation) return null;
      const page = await browserAutomation.snapshot();
      const archived = await new SiteSnapshots(
        uraRuntime!.ura,
        uraRuntime!.host,
        () => workspacePath,
      ).capture(page);
      return {
        url: page.url,
        title: page.title,
        markdown: page.markdown.slice(0, 4000),
        ref: archived?.ref ?? null,
      };
    },
    onSettingsChanged: (pluginId) => {
      broadcastToWindows(CH_URA, {
        ref: `plugin://${pluginId}`,
        type: 'state',
        at: Date.now(),
      });
    },
    storageInfo: () => {
      const wsId = getWorkspaceId(workspacePath);
      const agentDir = getAgentDir();
      const globalSettings = path.join(agentDir, 'settings.json');
      let configuredSessionDir: string | null = null;
      try {
        const raw = JSON.parse(readFileSync(globalSettings, 'utf-8')) as {
          sessionDir?: unknown;
        };
        if (typeof raw.sessionDir === 'string' && raw.sessionDir)
          configuredSessionDir = raw.sessionDir;
      } catch {
        /* 未配置 / 损坏按未配置处理 */
      }
      return {
        workspacePath,
        workspaceId: wsId,
        agentDir,
        modelsJson: path.join(agentDir, 'models.json'),
        authJson: path.join(agentDir, 'auth.json'),
        globalSettings,
        workspaceSettings: path.join(getWorkspaceBase(wsId), 'settings.json'),
        sessionsDir: agent?.resolveSessionsDir() ?? '',
        defaultSessionsDir: getSessionsDir(wsId),
        sessionsDirConfigured: configuredSessionDir,
        uiStateFile: path.join(getWorkspaceBase(wsId), 'ui-state.json'),
        resourcesDir: getWorkspaceResourcesDir(wsId),
        pluginsDirs: [
          path.join(app.getAppPath(), 'src', 'plugins'),
          path.join(app.getPath('userData'), 'plugins'),
        ],
        bootLog: bootLogFile,
        versions: {
          app: app.getVersion(),
          electron: process.versions['electron'] ?? '',
          chrome: process.versions['chrome'] ?? '',
          node: process.versions['node'] ?? '',
        },
      };
    },
  };
  registerRouter(routerDeps);

  appHost = new AppHost({
    snapshot: (epochs) =>
      buildAppSnapshot(
        {
          agent: agent!,
          sessions: sessionAdapter,
          lists: listService,
          viewHost: viewHost!,
          uiState,
          registry: uraRuntime!.host,
          pluginService: pluginService!,
          workspacePath,
          resourceMapVersion: () => uraRuntime?.map.currentVersion ?? '',
          layout: buildLayout,
        },
        epochs,
      ),
    dispatch: (command) =>
      invoke(
        routerDeps,
        command.action,
        (command.payload ?? {}) as Record<string, unknown>,
      ),
  });
  registerAppIpc(routerDeps);
  publishAppSnapshot();

  nativeFacilities.registerShellIpc(() => winRef);
  registerShortcuts();

  // UiState 变更 → 布局重算 / 主题收敛 / 视图广播
  uiState.onChanged((state: UiState) => {
    viewHost?.onThemeChanged(state.theme);
    applyLayout();
    broadcastViews();
  });

  bootLog('router + facilities ready');
  // 8. 主窗口 + 视图挂载
  winRef = createWindow();
  viewHost.attach(winRef);
  buildAppMenu();
  bootLog('window created');
  viewHost.restore();
  workspaceManager = new WorkspaceManager();
  workspaceManager.adopt(
    new WorkspaceScope({
      path: workspacePath,
      id: wsId,
      uiState,
      viewHost,
      pageSessions,
      writeSessions,
    }),
  );
  await viewHost.createAssistantView();
  bootLog('assistant view created');
  await viewHost.createOverlayView();
  viewHost.warmCaptureView(); // 捕获层预热：避免首次拖拽的页面加载竞态
  applyLayout();
  bootLog('boot complete');

  // 插件页协议（默认 session：工作台窗口；各原生视图 partition 在创建视图时注册）
  registerAppProtocol(session.defaultSession);

  // 生产 CSP（工作台页面；插件页自持 CSP）
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
          ],
        },
      });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      winRef = createWindow();
      viewHost?.attach(winRef);
      void viewHost?.createAssistantView();
      void viewHost?.createOverlayView();
    }
  });
});

// ─── 关闭 ─────────────────────────────────────────────────

let isQuitting = false;
app.on('before-quit', (e) => {
  if (isQuitting) return;
  isQuitting = true;
  e.preventDefault();
  try {
    agent?.dispose();
  } catch (err) {
    log.error('agent dispose', err);
  }
  try {
    uiState.flushNow();
  } catch (err) {
    log.error('ui-state flush', err);
  }
  try {
    interaction?.dispose();
  } catch (err) {
    log.error('interaction dispose', err);
  }
  try {
    workspaceWatcher?.close();
  } catch (err) {
    log.error('workspace watch dispose', err);
  }
  try {
    workspaceManager?.dispose();
  } catch (err) {
    log.error('workspace manager dispose', err);
  }
  try {
    viewHost?.dispose();
  } catch (err) {
    log.error('viewHost dispose', err);
  }
  setTimeout(() => app.exit(0), 200);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
