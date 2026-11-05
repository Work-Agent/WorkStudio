/**
 * 跨层契约：路径参数、来源、授权、帧、页面提供者。
 *
 * 只放类型，不放实现——渲染层、App 层、模块共用这一份。
 */

export type Params = Record<string, string>;

/** 视图种类：系统视图固定，内容视图由页面提供者创建。 */
export type ViewType =
  | 'shell'
  | 'assistant'
  | 'overlay'
  | 'capture'
  | 'page'
  | 'web';

export type Theme = 'light' | 'dark';

/** 视图的授权范围：路径模式，默认拒绝。 */
export interface Grant {
  call?: string[];
  watch?: string[];
}

/** 消息来源：视图、模块、AI 工具面。 */
export type Origin =
  | { type: 'view'; viewId: string; viewType: ViewType; path: string | null }
  | { type: 'service'; id: string; base: string }
  | { type: 'tool'; name: string };

/** 命令处理器的入参。 */
export interface RouteCall<I = unknown> {
  /** 具体路径（参数已替换）。 */
  path: string;
  /** 所属模块的挂载前缀。 */
  base: string;
  /** 挂载参数 + 路径参数。 */
  params: Params;
  input: I;
  origin: Origin;
}

export interface StateFrame<T = unknown> {
  type: 'state';
  path: string;
  value: T;
}

export interface EventFrame<T = unknown> {
  type: 'event';
  path: string;
  /** 宿主按路径自增；不保证送达。 */
  seq: number;
  at: number;
  value: T;
}

export type Frame<T = unknown> = StateFrame<T> | EventFrame<T>;

export type RouteErrorCode = 'unknown' | 'denied' | 'invalid' | 'failed';

export interface RouteError {
  code: RouteErrorCode;
  message: string;
}

export type RouteResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: RouteError };

/** 内容视图的规格：由所属模块的页面提供者给出。 */
export interface ViewSpec {
  type: 'page' | 'web';
  url: string;
  title: string;
  grants: Grant;
  partition?: string;
  preload?: 'page' | 'web' | 'none';
  sessionId?: string;
  /** 资源页内容投递：loaded 时调用，取当前快照。 */
  content?: () => unknown;
}

/** 页面提供者：认领一段路径模式，只有注册它的模块能打开。 */
export interface ViewProvider {
  /** 认领的路径模式，如 '/workspaces/:wsId/resources/pages/:pageId'。 */
  path: string;
  resolve(call: RouteCall<{ path: string }>): ViewSpec | Promise<ViewSpec>;
  release?(path: string): void;
}

/** 记录一次打开请求：views/open 的入参。 */
export interface OpenViewInput {
  path: string;
}
