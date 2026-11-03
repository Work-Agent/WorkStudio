/** 新版传输帧：状态快照或受约束的事件增量。 */
export type AppFrame<T = unknown> =
  | { type: 'state'; path: string; value: T }
  | { type: 'event'; path: string; seq: number; value: T };

/** appBridge 传输桥（所有工作台 / 助手 / 浮层 / 插件页统一入口）。 */
export interface AppBridge {
  available: () => Promise<boolean>;
  call: <T = unknown>(
    path: string,
    input?: unknown,
  ) => Promise<
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
  >;
  watch: (paths: string[]) => Promise<{ granted: string[]; denied: string[] }>;
  emit: (path: string, value?: unknown) => void;
  on: (cb: (frame: AppFrame) => void) => () => void;
  peek: <T = unknown>(path: string) => Promise<T | null>;
}

declare global {
  interface Window {
    appBridge?: AppBridge;
  }
}
