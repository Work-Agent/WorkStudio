import type { AppCommand, AppEvent, AppSnapshot } from './app';
import type {
  AgentStatus,
  CommandResponse,
  ElectronAPI,
  InteractionBeginInput,
  PiBridgeAPI,
  PopupMenuAPI,
  UiDialogResponse,
  UiRequest,
  WorkAPI,
} from './types';

/** 工作台桥（preload/workbench.ts，window.workbench）。 */
export interface WorkbenchBridge {
  platform: string;
  versions?: Record<string, string>;
  openPath: (path: string) => Promise<string>;
  cmd: <T = unknown>(
    command: string,
    params?: unknown,
  ) => Promise<CommandResponse<T>>;
  appSync: () => Promise<AppSnapshot>;
  appCmd: <T = unknown>(command: AppCommand) => Promise<CommandResponse<T>>;
  onAppSnapshot: (cb: (snapshot: AppSnapshot) => void) => () => void;
  onAppEvent: (cb: (event: AppEvent) => void) => () => void;
  onResources: (cb: (event: unknown) => void) => () => void;
  /** 订阅一个资源（传空取消）；变更经 onUra 推送。 */
  watchUra: (ref?: string) => Promise<{ ref: string } | null>;
  onUra: (cb: (event: unknown) => void) => () => void;
  onBus: (
    cb: (message: { viewId: string; message: unknown }) => void,
  ) => () => void;
  onUi: (cb: (request: UiRequest) => void) => () => void;
  onPopupSelect: (
    cb: (event: { source: string; actionId: string }) => void,
  ) => () => void;
  onInteraction: (cb: (update: { preview: unknown }) => void) => () => void;
  interaction: {
    begin: (input: InteractionBeginInput) => Promise<{ ok: boolean }>;
    move: () => Promise<{ ok: boolean }>;
    end: () => Promise<{ ok: boolean }>;
    cancel: () => Promise<{ ok: boolean }>;
  };
  ui: {
    respond: (response: UiDialogResponse) => Promise<CommandResponse>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    pickDirectory: () => Promise<string | null>;
    showPopup: (input: {
      source: string;
      items: Array<{ id: string; label: string; disabled?: boolean }>;
    }) => Promise<boolean>;
    closePopup: () => Promise<boolean>;
  };
}

/** 助手视图桥（preload/assistant.ts，window.assistant）。 */
export interface AssistantBridge {
  platform: string;
  cmd: <T = unknown>(
    command: string,
    params?: unknown,
  ) => Promise<CommandResponse<T>>;
  appSync: () => Promise<AppSnapshot>;
  onAppSnapshot: (cb: (snapshot: AppSnapshot) => void) => () => void;
  onAppEvent: (cb: (event: AppEvent) => void) => () => void;
  onInteraction: (cb: (update: { preview: unknown }) => void) => () => void;
  interaction: {
    begin: (input: InteractionBeginInput) => Promise<{ ok: boolean }>;
    move: () => Promise<{ ok: boolean }>;
    end: () => Promise<{ ok: boolean }>;
    cancel: () => Promise<{ ok: boolean }>;
  };
  ui: {
    respond: (response: UiDialogResponse) => Promise<CommandResponse>;
  };
  onPopupSelect: (
    cb: (event: { source: string; actionId: string }) => void,
  ) => () => void;
  shell: {
    showPopup: (input: {
      source: string;
      items: Array<{ id: string; label: string; disabled?: boolean }>;
    }) => Promise<boolean>;
    closePopup: () => Promise<boolean>;
  };
}

/** 浮层视图桥（preload/overlay.ts，window.overlay）。 */
export interface OverlayBridge {
  onUi: (cb: (request: UiRequest) => void) => () => void;
  respond: (response: UiDialogResponse) => Promise<CommandResponse>;
}

declare global {
  interface Window {
    /** 新工作台桥（preload/workbench.ts）。 */
    workbench?: WorkbenchBridge;
    /** AI 助手视图桥。 */
    assistant?: AssistantBridge;
    /** 浮层视图桥。 */
    overlay?: OverlayBridge;
    /** 旧渲染层兼容桥（过渡期；缺失时渲染层走 mock）。 */
    electronAPI?: ElectronAPI;
    agentAPI?: WorkAPI;
    piAPI?: PiBridgeAPI;
    popupMenu?: PopupMenuAPI;
  }
}

export type { AgentStatus };
