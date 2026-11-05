/**
 * App 层中间件：多视图管理的唯一实现。
 *
 * 视图集合 / 系统视图 / 几何 / 主题 / 现场 / 交互 / 对话框 / 通知 / 原生能力，
 * 全部以根路径暴露；前端只发交互、只吃状态帧。
 */

import { CH_BUS } from '../../shared/channels';
import type { StateHandle } from '../core/handles';
import type { OpenViewInput, RouteCall, Theme, ViewType } from '../core/types';
import { RouteFailure } from '../core/failure';
import { DialogsController } from './views/dialogs';
import { SceneController } from './views/scene-controller';
import { ViewRuntime } from './views/view-runtime';
import { FRAME_CHANNEL, SystemViews } from './views/system-views';
import type { CreateViewRequest } from './views/types';

export type { CreateViewRequest } from './views/types';
import { match } from '../core/paths';
import type { WebContents } from 'electron';
import type { ElectronCapability } from './electron-middleware';
import type {
  GlobalRegistration,
  Capability,
  MiddlewareContext,
} from './middleware';
import type { Bus } from '../core/bus';
import type { ProviderRegistry } from './providers';
import type { ViewRegistry } from './views';
import type { ViewRecord, ViewSnapshot } from './views';

interface WorkspaceRef {
  id: string;
}

export class ViewsCapability implements Capability {
  readonly id = 'views';

  private bus!: Bus;
  private viewRegistry!: ViewRegistry;
  private providers!: ProviderRegistry;
  private global!: GlobalRegistration;
  private theme!: Theme;
  private dialogs!: DialogsController;
  private scene!: SceneController;
  private runtime!: ViewRuntime;
  private system!: SystemViews;
  private unsubscribe: (() => void) | null = null;

  private viewsState!: StateHandle<ViewSnapshot[]>;
  private themeState!: StateHandle<Theme>;

  constructor(private readonly electron: ElectronCapability) {}

  install(ctx: MiddlewareContext): void {
    this.bus = ctx.bus;
    this.viewRegistry = ctx.views;
    this.providers = ctx.providers;
    this.global = ctx.global;
    this.theme = this.electron.theme.read();
    this.runtime = new ViewRuntime(
      this.viewRegistry,
      this.electron,
      this.providers,
    );
    this.system = new SystemViews(this.electron, this.viewRegistry, (input) =>
      this.createView(input),
    );
    this.scene = new SceneController(
      this.electron,
      () => this.theme,
      () => this.system.captureId(),
    );
    this.scene.install(this.global);
    this.register();
    this.dialogs = new DialogsController({
      overlay: () => this.electron.views,
      overlayId: () => this.system.overlayId(),
    });
    this.dialogs.install(this.global);
  }

  private register(): void {
    const global = this.global;

    this.viewsState = global.state<ViewSnapshot[]>('/views');
    this.themeState = global.state<Theme>('/theme');

    global.handle('/views/open', (call) =>
      this.open(call as RouteCall<OpenViewInput>),
    );
    global.handle('/views/close-all', () => {
      this.runtime.closeAll();
      return null;
    });
    for (const action of [
      'activate',
      'close',
      'reload',
      'navigate',
      'action',
      'toggle-pin',
      'move',
      'close-others',
      'close-to-left',
      'close-to-right',
      'go-back',
      'go-forward',
      'run-action',
    ]) {
      global.handle(`/views/:viewId/${action}`, (call) =>
        this.runtime.command(action, call),
      );
    }

    global.handle('/theme/set', (call) =>
      this.setTheme(call as RouteCall<{ theme?: Theme }>),
    );
    global.handle('/native/open-external', (call) => {
      const input = call.input as { url?: string } | undefined;
      this.electron.native.openExternal(String(input?.url ?? ''));
      return null;
    });
    global.handle('/native/open-path', (call) => {
      const input = call.input as { path?: string } | undefined;
      this.electron.native.openPath(String(input?.path ?? ''));
      return null;
    });
    global.handle('/native/pick-directory', () =>
      this.electron.native.pickDirectory(),
    );
    global.handle('/native/save-file', (call) => {
      const input = call.input as
        | {
            title?: string;
            defaultPath?: string;
            filters?: Array<{ name: string; extensions: string[] }>;
          }
        | undefined;
      return this.electron.native.pickSaveFile(input ?? {});
    });
    global.handle('/native/popup-menu', (call) => {
      const input = call.input as
        | { items?: Array<{ id: string; label: string; disabled?: boolean }> }
        | undefined;
      return this.electron.native.popupMenu(input?.items ?? []);
    });

    global.inbound('/views/:viewId/ready', (call) => {
      this.viewRegistry.setState(String(call.params['viewId']), 'ready');
    });
    global.inbound('/views/:viewId/dirty', (call) => {
      const input = call.input as { dirty?: boolean } | boolean | undefined;
      const dirty = typeof input === 'boolean' ? input : Boolean(input?.dirty);
      this.viewRegistry.setDirty(String(call.params['viewId']), dirty);
    });

    this.viewRegistry.onChange(() => {
      this.viewsState.publish(this.viewRegistry.list());
    });
  }

  /** 启动阶段：视图身份 → 系统视图 → 主题 / 现场 / 布局。 */
  activate(): void {
    this.system.ensure();
    this.electron.theme.apply(this.theme);
    this.themeState.publish(this.theme);
    this.dialogs.activate();
    this.viewsState.publish(this.viewRegistry.list());

    this.unsubscribe = this.bus.subscribe((frame) => {
      if (frame.type !== 'state') return;
      if (frame.path !== '/workspaces/current') return;
      this.scene.onCurrent((frame.value as WorkspaceRef | null) ?? null);
    });
    this.scene.onCurrent(this.bus.read<WorkspaceRef>('/workspaces/current'));
    this.scene.activate();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** 基本标签快捷键：Cmd/Ctrl+W 关闭激活视图，Cmd/Ctrl+1..9 激活第 N 个视图。 */
  attachShortcuts(wc: WebContents): void {
    this.runtime.attachShortcuts(wc);
  }

  /** 窗口重建后重新绑定 shell 与系统视图。 */
  reactivate(): void {
    this.system.reactivate();
    this.viewsState.publish(this.viewRegistry.list());
  }

  /** 热卸载：关闭某插件的全部已打开视图（页面 / 配置页）。 */
  closePluginViews(pluginId: string): void {
    const targets = new Set([
      `/plugins/page/${pluginId}`,
      `/plugins/settings/${pluginId}`,
    ]);
    for (const view of this.viewRegistry.list()) {
      if (view.contentPath && targets.has(view.contentPath)) {
        this.runtime.close(view.id);
      }
    }
  }

  // ─── 视图 ─────────────────────────────────────────────

  getWebContents(viewId: string): import('electron').WebContents | null {
    return this.electron.views.webContents(viewId);
  }

  browserViews(): ViewSnapshot[] {
    return this.viewRegistry.list().filter((view) => view.type === 'web');
  }

  /** 浏览器自动化入口：新建 raw 网页视图并激活。 */
  openBrowser(url: string): ViewRecord {
    const record = this.createView({
      type: 'web',
      title: url,
      url,
      preload: 'web',
      grants: {},
    });
    this.viewRegistry.setActive(record.id);
    this.electron.views.activate(record.id);
    return record;
  }

  createView(input: CreateViewRequest): ViewRecord {
    const record = this.viewRegistry.create({
      type: input.type,
      title: input.title,
      url: input.url,
      grants: input.grants,
      sessionId: input.sessionId ?? null,
      contentPath: input.contentPath ?? null,
    });
    const wcId = this.electron.views.create(
      {
        viewId: record.id,
        type: record.type,
        url: record.url,
        title: record.title,
        partition: input.partition,
        preload: input.preload,
      },
      {
        onReady: () => {
          this.viewRegistry.setState(record.id, 'ready');
          this.electron.views.send(record.id, CH_BUS, {
            type: 'theme',
            theme: this.theme,
          });
        },
        onCrash: () => this.viewRegistry.setState(record.id, 'crashed'),
        onBus: (message) => {
          if (
            input.content !== undefined &&
            (message as { type?: string }).type === 'loaded'
          ) {
            this.electron.views.send(record.id, CH_BUS, {
              type: 'content',
              payload: input.content,
            });
          }
        },
      },
    );
    if (wcId !== null) {
      this.viewRegistry.bind(record.id, String(wcId));
      this.installNavigationPolicy(record);
    }
    this.viewRegistry.attach(record.id, (frame) =>
      this.electron.views.send(record.id, FRAME_CHANNEL, frame),
    );
    if (
      (input.type === 'page' || input.type === 'web') &&
      !this.viewRegistry.activeId()
    ) {
      this.viewRegistry.setActive(record.id);
      this.electron.views.activate(record.id);
    }
    return record;
  }

  /**
   * 内容视图导航策略。
   *
   * 网页标签自己跳转（只限 http/https）；页面里的新窗口落到浏览器面的临时标签。
   * 其余视图（资源页 / 插件页 / 设置页 / 系统视图）不允许自身导航，外链交给
   * 系统浏览器——工作台壳层同样如此，策略只在壳窗自己的 webContents 上生效。
   */
  private installNavigationPolicy(record: ViewRecord): void {
    const wc = this.electron.views.webContents(record.id);
    if (!wc) return;
    const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);
    wc.on('will-attach-webview', (event) => event.preventDefault());
    if (record.type === 'web') {
      wc.on('will-navigate', (details) => {
        if (!isHttp(details.url)) details.preventDefault();
      });
      wc.setWindowOpenHandler(({ url }) => {
        if (isHttp(url)) this.openBrowserTab(url);
        return { action: 'deny' };
      });
      return;
    }
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(({ url }) => {
      this.electron.native.openExternal(url);
      return { action: 'deny' };
    });
  }

  /** 网页里的新窗口 → 浏览器面临时标签；同一 URL 复用已有标签。 */
  private openBrowserTab(url: string): void {
    const existing = this.viewRegistry
      .list()
      .find((view) => view.type === 'web' && view.url === url);
    if (existing) {
      this.viewRegistry.setActive(existing.id);
      this.electron.views.activate(existing.id);
      return;
    }
    this.openBrowser(url);
  }

  private async open(
    call: RouteCall<OpenViewInput>,
  ): Promise<{ id: string; type: ViewType; title: string }> {
    const path = call.input?.path;
    if (!path) throw new RouteFailure('invalid', 'path is required');
    const provider = this.providers.match(path);
    if (!provider) {
      throw new RouteFailure('failed', `no view provider for ${path}`);
    }
    if (
      call.origin.type !== 'service' ||
      call.origin.id !== provider.serviceId
    ) {
      throw new RouteFailure(
        'denied',
        `only ${provider.serviceId} can open ${path}`,
      );
    }
    const existing = this.viewRegistry.findByContentPath(path);
    if (existing) {
      this.viewRegistry.setActive(existing.id);
      this.electron.views.activate(existing.id);
      return {
        id: existing.id,
        type: existing.type,
        title: existing.title,
      };
    }

    const spec = await provider.resolve({
      ...call,
      params: { ...call.params, ...match(provider.path, path) },
      input: { path },
    });
    const record = this.createView({ ...spec, contentPath: path });
    this.viewRegistry.setActive(record.id);
    this.electron.views.activate(record.id);
    this.scene.publishLayout();
    return { id: record.id, type: record.type, title: record.title };
  }

  /** 工作区换代 / 退出：关闭所有内容视图（系统视图保留）。 */
  closeAll(): void {
    this.runtime.closeAll();
  }

  /** Agent 对话框应答回传（由组合根绑定到 DialogHost）。 */
  setDialogResponder(
    responder: (
      response: import('../../shared/types').UiDialogResponse,
    ) => void,
  ): void {
    this.dialogs.setResponder(responder);
  }

  /** DialogHost 结算（超时 / 会话关闭）后撤卡。 */
  resolveDialog(id: string): void {
    this.dialogs.resolve(id);
  }

  private setTheme(call: RouteCall<{ theme?: Theme }>): Theme {
    const theme = call.input?.theme;
    if (theme !== 'light' && theme !== 'dark') {
      throw new RouteFailure('invalid', 'theme must be light or dark');
    }
    this.theme = theme;
    this.electron.theme.write(theme);
    this.electron.theme.apply(theme);
    this.themeState.publish(theme);
    for (const view of this.viewRegistry.list()) {
      this.electron.views.send(view.id, CH_BUS, { type: 'theme', theme });
    }
    this.scene.publishLayout();
    return theme;
  }
}
