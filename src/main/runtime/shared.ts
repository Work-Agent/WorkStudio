/**
 * 应用共享契约与纯工具：帧 / domain key / 失败。
 *
 * 这里只放跨组件的数据类型与纯函数。
 */

export type Theme = 'light' | 'dark';

/** 主题来源：固定亮 / 固定暗 / 跟随系统。 */
export type ThemeSource = Theme | 'system';

export const IPC_CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
} as const;

/** 原生现场：具体字段由应用决定，框架只负责读写。 */
export type NativeScene = Record<string, unknown>;

/** 视图种类：系统视图固定，内容视图由页面提供者创建。 */
export type ViewType =
  | 'shell'
  | 'assistant'
  | 'overlay'
  | 'capture'
  | 'page'
  | 'web';

/** 消息来源：视图、模块、AI 工具面。 */
export type Origin =
  | { type: 'view'; viewId: string; viewType: ViewType }
  | { type: 'service'; id: string }
  | { type: 'tool'; name: string };

export type Patch = Record<string, unknown>;

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshot {
  assistantMode: 'dock' | 'floating';
  assistantVisible: boolean;
  window: { width: number; height: number };
  titlebar: LayoutRect;
  workbench: LayoutRect;
  sidebar: LayoutRect;
  resourcePane: LayoutRect;
  tabbar: LayoutRect;
  resourceContent: LayoutRect;
  assistantDock: LayoutRect;
  assistantFloating: LayoutRect;
  overlay: LayoutRect;
  capture: LayoutRect;
}

export interface UiDialogRequest {
  id: string;
  type: 'dialog';
  dialogType: 'select' | 'input' | 'editor' | 'confirm';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  secret?: boolean;
}

export interface UiDialogResponse {
  id: string;
  value?: string | boolean;
  confirmed?: boolean;
  cancelled?: boolean;
}

export interface DialogView {
  id: string;
  request: UiDialogRequest | null;
  status: 'open' | 'resolved' | 'cancelled';
  response?: UiDialogResponse;
}

export interface AppNotice {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

export type DomainEventHandler = (
  payload: unknown,
  source: string,
) => void | Promise<void>;

export type DomainUpdate =
  | { type: 'snapshot'; domain: string; resource: string; data: unknown }
  | { type: 'patch'; domain: string; resource: string; data: Patch }
  | {
      type: 'event';
      domain: string;
      resource: string;
      event: string;
      data: unknown;
      seq?: number;
    };

export type CallErrorCode = 'unknown' | 'denied' | 'invalid' | 'failed';

export interface CallError {
  code: CallErrorCode;
  message: string;
}

export type CallResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: CallError };

/** 命令 / 入站处理器的入参。 */
export interface CallContext<I = unknown> {
  domain: string;
  resource: string;
  action: string;
  input: I;
  origin: Origin;
}

export type Next<T = unknown> = () => Promise<T>;

/**
 * 路由失败与结果归约。
 *
 * 业务 handler 可以抛 CallFailure 指定错误码；其他异常统一 failed。
 */
export class CallFailure extends Error {
  readonly code: CallErrorCode;

  constructor(code: CallErrorCode, message: string) {
    super(message);
    this.name = 'CallFailure';
    this.code = code;
  }
}

export function errorResult(error: unknown): CallResult<never> {
  if (error instanceof CallFailure) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'failed', message: messageOf(error) } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
