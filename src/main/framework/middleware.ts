/**
 * App 层两类扩展：
 *
 * - Capability：全局能力（Electron / 视图 / 主题 / 现场），有 install / activate / dispose 生命周期；
 * - Middleware：请求中间件，只包裹入站 call，不拦截 state / event 出站。
 *
 * 两者职责不同：能力提供运行时，中间件处理请求链。
 */

import type { StateHandle } from '../core/handles';
import type { Bus } from '../core/bus';
import type { Origin, RouteCall, RouteResult } from '../core/types';
import type { ProviderRegistry } from './providers';
import type { ViewRegistry } from './views';

/** 入站传输绑定（ElectronCapability 用 ipcMain 落地）。 */
export interface TransportBindings {
  originOf(externalId: string): Origin | null;
  call(origin: Origin, path: string, input?: unknown): Promise<RouteResult>;
  watch(
    viewId: string,
    paths: string[],
  ): Promise<{ granted: string[]; denied: string[] }>;
  emit(origin: Origin, path: string, value: unknown): void;
  peek<T = unknown>(path: string): T | null;
}

/** 全局注册面：直接使用根路径。 */
export interface GlobalRegistration {
  handle<I, O>(
    path: string,
    handler: (call: RouteCall<I>) => O | Promise<O>,
  ): void;
  state<T>(path: string): StateHandle<T>;
  inbound(path: string, handler: (call: RouteCall) => void): void;
}

export interface MiddlewareContext {
  readonly bus: Bus;
  readonly views: ViewRegistry;
  readonly providers: ProviderRegistry;
  readonly global: GlobalRegistration;
  readonly transport: TransportBindings;
}

/** 全局能力：生命周期式，不参与请求链。 */
export interface Capability {
  readonly id: string;
  install(ctx: MiddlewareContext): void;
  activate?(ctx: MiddlewareContext): void;
  dispose?(): void;
}

/** 请求中间件：只包裹入站 call；path 缺省为全局。 */
export interface Middleware {
  readonly id: string;
  readonly path?: string;
  handle(
    call: RouteCall,
    next: () => Promise<RouteResult>,
  ): Promise<RouteResult> | RouteResult;
}

/** App 内部登记后的中间件：路径已规范化。 */
export interface RegisteredMiddleware {
  readonly path: string;
  readonly middleware: Middleware;
}
