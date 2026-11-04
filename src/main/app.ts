/**
 * App：单例宿主对象，也是组合根。
 *
 *   App.claim(runtime) → useCapability(capability) / use(middleware) → start()
 *   start: repo → 引擎 → service → Router 分组 → host.useCall → service.start
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from './core/paths';
import { fileRef } from '../shared/ura';
import type { Origin, RouteResult } from './core/types';
import { Host } from './framework/host';
import { Router } from './router/router';
import type { ViewRecord, ViewRegistry } from './framework/views';
import type {
  Capability,
  Middleware,
  MiddlewareContext,
  RegisteredMiddleware,
  TransportBindings,
} from './framework/middleware';
import type { ElectronCapability } from './framework/electron-middleware';
import { AppGlobal } from './framework/global';
import type {
  CreateViewRequest,
  ViewsCapability,
} from './framework/views-middleware';

import { registerRoutes } from './router/register';

import { ListsService } from './service/lists';
import { PiConfService } from './service/piconf';
import { PluginsService } from './service/plugins';
import { ResourcesService } from './service/resources';
import { SessionsService } from './service/sessions';
import { SettingsService, type SettingsPageCatalog } from './service/settings';
import { SitesService } from './service/sites';
import { WorkspacesService } from './service/workspaces';
import { AgentHost } from './agent/agent-host';
import { BrowserAutomation } from './capabilities/browser/automation';
import { registerBrowserFeatures } from './capabilities/browser/features';
import {
  ModelConfigStore,
  SettingsService as PiSettingsService,
} from './agent/config-service';
import { PiPackageService } from './agent/package-service';
import { AppSpaceSettingsStorage } from './agent/settings-storage';
import {
  getWorkspaceBase,
  initAgentDir,
  registerWorkspace,
} from './agent/workspace';
import { SkillsManager } from './harness/skills';
import { settingsPage, settingsPages } from './capabilities/settings/registry';
import { createUraRuntime, type UraRuntime } from './ura';
import { PageSessions } from './ura/page-sessions';
import { PluginService } from './plugins/service';
import { PluginCatalogService } from './plugins/catalog';
import {
  pluginCatalogFile,
  pluginCatalogUrlFile,
  pluginDataRoot,
  pluginsRoot,
  uraBindingsFile,
} from './paths';

export class App {
  private static instance: App | null = null;

  static claim(runtime: ElectronCapability): App {
    if (App.instance) return App.instance;
    return (App.instance = new App(runtime));
  }

  readonly host: Host;
  readonly router: Router;
  readonly views: ViewRegistry;

  private readonly capabilities: Capability[] = [];
  private readonly middlewares: RegisteredMiddleware[] = [];
  private ctx: MiddlewareContext | null = null;
  private started = false;

  private workspaces!: WorkspacesService;
  private resources!: ResourcesService;
  private lists!: ListsService;
  private sessions!: SessionsService;
  private plugins!: PluginsService;
  private piconf!: PiConfService;
  private settings!: SettingsService;
  private sites!: SitesService;
  private viewsCapability!: ViewsCapability;
  private browserAutomation: BrowserAutomation | null = null;
  private agentHost: AgentHost | null = null;
  private uraRuntime: UraRuntime | null = null;
  private workspaceWatch: { close(): void } | null = null;

  private constructor(private readonly runtime: ElectronCapability) {
    this.host = new Host();
    this.router = new Router(this.host);
    this.views = this.host.views;
  }

  /** 注册全局能力：窗口、视图、主题等生命周期式运行时。 */
  useCapability(capability: Capability): this {
    if (this.started) throw new Error('cannot use capability after start');
    this.capabilities.push(capability);
    return this;
  }

  /** 注册请求中间件：只包裹入站 call；路径缺省为全局。 */
  use(middleware: Middleware): this;
  use(path: string, middleware: Middleware): this;
  use(pathOrMiddleware: string | Middleware, maybe?: Middleware): this {
    if (this.started) throw new Error('cannot use middleware after start');
    if (typeof pathOrMiddleware === 'string') {
      if (!maybe) throw new Error('middleware is required');
      this.middlewares.push({
        path: normalize(pathOrMiddleware),
        middleware: maybe,
      });
      return this;
    }
    this.middlewares.push({ path: '/', middleware: pathOrMiddleware });
    return this;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // ─── repo → 引擎 → service ──────────────────────────
    const env = this.runtime.env;
    initAgentDir(env.dataRoot);
    for (const dir of [env.dataRoot, pluginDataRoot(), pluginsRoot()]) {
      mkdirSync(dir, { recursive: true });
    }

    const workspaces = new WorkspacesService(env.documentsDir);
    const initial = workspaces.restore();
    let workspacePath = initial.path;

    const pluginService = new PluginService({
      root: pluginsRoot(),
      cwd: () => workspacePath,
    });
    await pluginService.start();
    const catalog = new PluginCatalogService({
      cacheFile: pluginCatalogFile(),
      urlFile: pluginCatalogUrlFile(),
    });
    await catalog.start();

    const ura = await createUraRuntime({
      dataRoot: pluginDataRoot(),
      bindingFile: uraBindingsFile(),
      workspace: () => workspacePath,
      registerFeatures: registerBrowserFeatures,
      onDeactivate: (pluginId) =>
        this.viewsCapability?.closePluginViews(pluginId),
      pluginRoots: [
        ...pluginService.roots(),
        join(env.appPath, 'src', 'plugins'),
        pluginsRoot(),
      ],
    });

    this.runtime.setUraWatcher((ref, onEvent) => {
      const handle = ura.ura.watch(ref, (event) => onEvent(event));
      return () => handle.close();
    });

    const skills = new SkillsManager();
    let sessions: SessionsService | null = null;
    const agent = await AgentHost.bootstrap(
      {
        ura: ura.ura,
        skills,
        registry: ura.host,
        getBrowserAutomation: () => this.browserAutomation,
        sendEvent: (frame) => sessions?.receiveFrame(frame),
        onTurnFinished: () => {
          void this.sessions?.refresh();
          const workspace = this.workspaces?.current;
          if (workspace) {
            void this.call(
              { type: 'service', id: 'lists', base: '' },
              `/workspaces/${workspace.id}/lists/refresh`,
            );
          }
        },
        onSessionCreated: () => {
          void this.sessions?.refresh();
        },
        onWorkspaceChange: (next) => {
          workspacePath = next;
          registerWorkspace(next);
          ura.map.restart();
          this.watchWorkspace();
        },
        ui: {
          onDialogRequest: (request) => {
            void this.call(
              { type: 'service', id: 'agent', base: '' },
              '/dialogs/open',
              { request },
            );
          },
          onDialogResolved: (id) => {
            const views = this.capabilities.find(
              (item): item is ViewsCapability => item.id === 'views',
            );
            views?.resolveDialog(id);
          },
          onNotify: (message, level, source) => {
            void this.call(
              { type: 'service', id: 'agent', base: '' },
              '/notify',
              {
                message,
                level: level === 'warning' ? 'warn' : level,
                source,
              },
            );
          },
        },
        openExternal: (url) => this.runtime.native.openExternal(url),
      },
      workspacePath,
    );
    sessions = new SessionsService(agent);
    this.agentHost = agent;
    this.uraRuntime = ura;
    this.viewsCapability?.setDialogResponder((response) =>
      agent.handleDialogResponse(response),
    );

    const settingsFor = (wsId: string): PiSettingsService =>
      new PiSettingsService(
        new AppSpaceSettingsStorage(
          join(env.dataRoot, 'settings.json'),
          join(getWorkspaceBase(wsId), 'settings.json'),
        ),
      );
    const lists = new ListsService({
      contexts: ura.contexts,
      agent,
      plugins: ura.host,
      settingsPages: () => this.settings.pages(),
      viewHost: {
        list: () =>
          this.views.list().map((view) => ({
            ...view,
            document: view.contentPath ? { id: view.contentPath } : undefined,
            temporary: false,
          })),
      },
    });
    const packages = new PiPackageService({
      settingsManager: () => agent.settingsManager,
      cwd: () => workspacePath,
      agentDir: () => env.dataRoot,
      onChanged: () => agent.reloadResources(),
    });

    this.workspaces = workspaces;
    this.resources = new ResourcesService({
      ura: ura.ura,
      pages: new PageSessions(ura.ura),
    });
    this.lists = lists;
    ura.map.restart();
    this.sessions = sessions;
    this.plugins = new PluginsService({
      service: pluginService,
      catalog,
      host: ura.host,
    });
    this.piconf = new PiConfService({
      settings: settingsFor(initial.id),
      models: new ModelConfigStore(env.dataRoot),
      packages,
      skills,
      agent,
      ura: ura.ura,
    });
    const settingsCatalog: SettingsPageCatalog = {
      pages: () => settingsPages().map(({ page: _page, ...entry }) => entry),
      page: (id) => {
        const page = settingsPage(id);
        return page
          ? { id: page.id, label: page.label, page: page.page }
          : null;
      },
    };
    this.settings = new SettingsService(
      env.dataRoot,
      env.appPath,
      () => agent,
      () => workspacePath,
      settingsCatalog,
    );
    this.sites = new SitesService({
      ura: ura.ura,
      workspace: () => workspacePath,
    });

    // ─── 中间件与路由 ──────────────────────────────────
    const ctx: MiddlewareContext = {
      bus: this.host.bus,
      views: this.host.views,
      providers: this.host.providers,
      global: new AppGlobal(this.host),
      transport: this.transport(),
    };
    this.ctx = ctx;

    for (const capability of this.capabilities) capability.install(ctx);
    const installedViews = this.capabilities.find(
      (item): item is ViewsCapability => item.id === 'views',
    );
    if (!installedViews) throw new Error('views capability is not installed');
    this.viewsCapability = installedViews;
    this.browserAutomation = new BrowserAutomation(this.viewsCapability);

    registerRoutes(this.router, {
      workspaces: this.workspaces,
      resources: this.resources,
      lists: this.lists,
      sessions: this.sessions,
      plugins: this.plugins,
      piconf: this.piconf,
      settings: this.settings,
      sites: this.sites,
    });
    this.host.useCall(this.middlewares);

    this.views.onChange(() => this.refreshLists());

    this.workspaces.onClose(() => {
      this.resources.reset();
      this.viewsCapability.closeAll();
    });
    this.workspaces.onOpen(async (meta) => {
      await agent.setWorkspace(meta.path);
      this.piconf.setSettings(settingsFor(meta.id));
      await this.sessions.reloadWorkspace();
    });

    this.workspaces.start();
    this.watchWorkspace();
    await this.sessions.start();

    for (const capability of this.capabilities) capability.activate?.(ctx);
    this.host.bus.flush();

    const table = this.host.snapshot();
    this.runtime.log(
      `ready: ${table.commands.length} routes, ${table.states.length} states, ${table.events.length} internal events`,
    );
  }

  activate(): void {
    for (const capability of this.capabilities)
      capability.activate?.(this.ctx!);
  }

  attachShortcuts(wc: unknown): void {
    const contents = wc as import('electron').WebContents;
    this.runtime.attach(contents);
    const views = this.capabilities.find(
      (item): item is ViewsCapability => item.id === 'views',
    );
    views?.attachShortcuts(contents);
  }

  reportFatal(error: unknown): void {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error('[app] fatal', message);
    this.runtime.log(`fatal: ${message}`);
  }

  private watchWorkspace(): void {
    this.workspaceWatch?.close();
    const root = this.workspaces?.current?.path;
    if (!root || !this.uraRuntime) return;
    this.workspaceWatch = this.uraRuntime.ura.watch(fileRef(root), () =>
      this.refreshLists(),
    );
  }

  private refreshLists(): void {
    const workspace = this.workspaces?.current;
    if (!workspace) return;
    void this.call(
      { type: 'service', id: 'lists', base: '' },
      `/workspaces/${workspace.id}/lists/refresh`,
    );
  }

  async release(): Promise<void> {
    for (const capability of [...this.capabilities].reverse()) {
      capability.dispose?.();
    }
    this.resources?.dispose();
    this.workspaceWatch?.close();
    this.workspaceWatch = null;
    this.uraRuntime?.map.dispose();
    this.agentHost?.dispose();
    this.host.dispose();
  }

  createView(input: CreateViewRequest): ViewRecord {
    const views = this.capabilities.find((item) => item.id === 'views') as
      | import('./framework/views-middleware').ViewsCapability
      | undefined;
    if (!views) throw new Error('views capability is not registered');
    return views.createView(input);
  }

  async call(
    origin: Origin,
    path: string,
    input?: unknown,
  ): Promise<RouteResult> {
    return this.host.call(origin, path, input);
  }

  watch(
    viewId: string,
    paths: string[],
  ): Promise<{ granted: string[]; denied: string[] }> {
    return this.host.watch(viewId, paths);
  }

  emit(origin: Origin, path: string, value: unknown): void {
    this.host.emit(origin, path, value);
  }

  peek<T>(path: string): T | null {
    return this.host.peek<T>(path);
  }

  flush(): void {
    this.host.bus.flush();
  }

  private transport(): TransportBindings {
    return {
      originOf: (externalId) => this.host.originOf(externalId),
      call: (origin, path, input) => this.host.call(origin, path, input),
      watch: (viewId, paths) => this.host.watch(viewId, paths),
      emit: (origin, path, value) => this.host.emit(origin, path, value),
      peek: (path) => this.host.peek(path),
    };
  }
}
