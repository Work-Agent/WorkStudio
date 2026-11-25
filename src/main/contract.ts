/**
 * 主进程跨层契约：结果、变更、来源。
 *
 * 线级类型来自 @workstudio/sdk；
 * 具体传输（ipcMain / preload / net）不进入契约。
 */

import type { CallErrorCode, CallResult, ChangeType } from '@workstudio/sdk';
export type {
  CallError,
  CallErrorCode,
  CallResult,
  ChangeType,
  DomainUpdate,
} from '@workstudio/sdk';

/** 系统视图种类：内容页统一归 page。 */
export type ViewType =
  | 'shell'
  | 'assistant'
  | 'overlay'
  | 'capture'
  | 'page'
  | 'web';

/** 请求来源：由主进程按发送方判定，页面不能自行声明。 */
export type Origin =
  | {
      type: 'view';
      viewId: string;
      viewType: ViewType;
      /** 视图所属工作区；由 ShellHost 按窗口登记，页面不能声明。 */
      workspaceId?: string;
      /** 插件视图所属插件；由 URL（plugin://<id>/...）推导，不读取入参。 */
      pluginId?: string;
    }
  | { type: 'service'; id: string }
  | { type: 'tool'; name: string };

export interface ChangeEvent {
  ref: string;
  type: ChangeType;
}

export const EXIT_CODE: Record<CallErrorCode, number> = {
  failed: 1,
  denied: 1,
  invalid: 2,
  unknown: 3,
  not_found: 3,
};

export function exitCodeOf(code: CallErrorCode): number {
  return EXIT_CODE[code];
}

export class CallFailure extends Error {
  readonly code: CallErrorCode;

  constructor(code: CallErrorCode, message: string) {
    super(message);
    this.name = 'CallFailure';
    this.code = code;
  }
}

export function failure(
  code: CallErrorCode,
  message: string,
): CallResult<never> {
  return { ok: false, error: { code, message } };
}

export function errorResult(error: unknown): CallResult<never> {
  if (error instanceof CallFailure) {
    return failure(error.code, error.message);
  }
  return failure(
    'failed',
    error instanceof Error ? error.message : String(error),
  );
}

/** 结构已就位、实现尚待迁移的显式出口。 */
export function notImplemented(name: string): never {
  throw new CallFailure('failed', `${name} 尚未实现`);
}
