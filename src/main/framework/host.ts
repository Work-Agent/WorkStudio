/**
 * Host —— App 层的运行时：路径表 + 总线 + 视图注册表。
 *
 * 入站（call / watch / emit）固定成一条管道：
 *   识别来源 → 代换 self → 授权 → 路由匹配 → 请求中间件链 → 处理器
 *
 * 中间件只包裹 call；watch / emit 与 state / event 出站不经过中间件。
 * 出站（publish / emit）由总线合并后交给视图注册表按订阅过滤。
 *
 * 业务绑定不在这里：由组合根通过 Router 把 service 方法绑到路径上。
 */

import { Bus } from '../core/bus';
import { RouteFailure } from '../core/failure';
import { EventHandle, StateHandle } from '../core/handles';
import { match, normalize, substituteSelf } from '../core/paths';
import { PathTable } from '../core/table';
import type { Owner, RouteHandler } from '../core/table';
import type { Frame, Origin, RouteCall, RouteResult } from '../core/types';
import type { RegisteredMiddleware } from './middleware';
import { ProviderRegistry } from './providers';
import { ViewRegistry } from './views';

interface Inbound {
  template: string;
  handler: (call: RouteCall) => void;
}

export class Host {
  readonly table = new PathTable();
  readonly bus = new Bus();
  readonly views = new ViewRegistry();
  readonly providers = new ProviderRegistry();

  private readonly inbound: Inbound[] = [];
  private callMiddlewares: RegisteredMiddleware[] = [];

  constructor() {
    this.bus.subscribe((frame: Frame) => this.views.deliver(frame));
  }

  registerCommand(
    template: string,
    base: string,
    owner: Owner,
    handler: RouteHandler,
  ): void {
    this.table.addCommand({ template, base, owner, handler });
  }

  registerState<T>(
    template: string,
    base: string,
    owner: Owner,
  ): StateHandle<T> {
    return new StateHandle<T>({
      table: this.table,
      bus: this.bus,
      template,
      base,
      owner,
    });
  }

  registerEvent<T>(
    template: string,
    base: string,
    owner: Owner,
    view = false,
    validate?: (value: unknown) => boolean,
  ): EventHandle<T> {
    return new EventHandle<T>({
      table: this.table,
      bus: this.bus,
      template,
      base,
      owner,
      view,
      validate,
    });
  }

  /** App 层自述事件（视图 ready / dirty 等）的入站处理器。 */
  registerInbound(template: string, handler: (call: RouteCall) => void): void {
    this.inbound.push({ template, handler });
  }

  /** 请求中间件只包裹 call；state / event 出站不受影响。 */
  useCall(middlewares: RegisteredMiddleware[]): void {
    this.callMiddlewares = [...middlewares];
  }

  async call(
    origin: Origin,
    rawPath: string,
    input?: unknown,
  ): Promise<RouteResult> {
    const path = this.resolve(origin, rawPath);
    const found = this.table.matchCommand(path);
    if (!found) {
      return {
        ok: false,
        error: { code: 'unknown', message: `no command at ${path}` },
      };
    }
    if (
      origin.type === 'view' &&
      !this.views.authorize(origin.viewId, 'call', path)
    ) {
      return {
        ok: false,
        error: { code: 'denied', message: `not allowed to call ${path}` },
      };
    }

    const call: RouteCall = {
      path,
      base: found.entry.base,
      params: found.params,
      input,
      origin,
    };

    let next = async (): Promise<RouteResult> => {
      try {
        const data = await found.entry.handler(call);
        return { ok: true, data };
      } catch (error) {
        return errorResult(error);
      }
    };

    for (const entry of this.chainFor(path).reverse()) {
      const inner = next;
      next = async () => entry.middleware.handle(call, inner);
    }

    try {
      return await next();
    } catch (error) {
      return errorResult(error);
    }
  }

  private chainFor(path: string): RegisteredMiddleware[] {
    return this.callMiddlewares.filter(({ path: prefix }) =>
      prefix === '/' ? true : path === prefix || path.startsWith(`${prefix}/`),
    );
  }

  async watch(
    viewId: string,
    rawPaths: string[],
  ): Promise<{ granted: string[]; denied: string[] }> {
    // 先把已排队的发布冲刷掉，避免 watch 回放与同一帧的 state 投递重复。
    this.bus.flush();
    const granted: string[] = [];
    const denied: string[] = [];
    for (const raw of rawPaths) {
      const path = substituteSelf(normalize(raw), viewId);
      if (
        !this.views.authorize(viewId, 'watch', path) ||
        !this.table.knownView(path)
      ) {
        denied.push(path);
        continue;
      }
      this.views.watch(viewId, [path]);
      const state = this.bus.state(path);
      if (state) {
        this.views.deliverTo(viewId, {
          type: 'state',
          path,
          value: state.value,
        });
      }
      granted.push(path);
    }
    return { granted, denied };
  }

  emit(origin: Origin, rawPath: string, value: unknown): void {
    if (origin.type !== 'view') return;
    const path = substituteSelf(normalize(rawPath), origin.viewId);
    for (const entry of this.inbound) {
      const params = match(entry.template, path);
      if (!params) continue;
      if (params['viewId'] && params['viewId'] !== origin.viewId) return;
      entry.handler({ path, base: path, params, input: value, origin });
      return;
    }
  }

  originOf(externalId: string): Origin | null {
    return this.views.originOf(externalId);
  }

  peek<T>(path: string): T | null {
    return this.bus.read<T>(path);
  }

  snapshot(): ReturnType<PathTable['snapshot']> {
    return this.table.snapshot();
  }

  dispose(): void {
    this.bus.dispose();
    this.views.clear();
  }

  private resolve(origin: Origin, rawPath: string): string {
    const path = normalize(rawPath);
    return origin.type === 'view' ? substituteSelf(path, origin.viewId) : path;
  }
}

function errorResult(error: unknown): RouteResult {
  if (error instanceof RouteFailure) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'failed', message: messageOf(error) } };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
