/**
 * 工作台 preload（contextBridge 白名单桥；不暴露 ipcRenderer）。
 *
 * 语义化 API：cmd / sync / 订阅（event / state / view / bus / ui / interaction）。
 * 兼容：保留 electronAPI（旧渲染层过渡期使用）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  CH_BUS,
  CH_CMD,
  CH_EVENT,
  CH_INTERACTION,
  CH_INTERACTION_UPDATE,
  CH_POPUP_SELECT,
  CH_RESOURCES,
  CH_SHELL,
  CH_STATE,
  CH_SYNC,
  CH_UI,
  CH_URA,
  CH_URA_WATCH,
  CH_VIEW,
} from '../shared/channels';
import type {
  CommandResponse,
  InteractionBeginInput,
  PopupMenuItem,
  PopupSelectEvent,
  UiDialogResponse,
  UiRequest,
  ViewEntry,
  ShellSnapshot,
  WorkSyncResult,
  PiEventFrame,
} from '../shared/types';

const api = {
  platform: process.platform,
  versions: process.versions as unknown as Record<string, string>,
  openPath: (target: string) =>
    ipcRenderer.invoke(CH_SHELL, 'openPath', {
      path: target,
    }) as Promise<string>,

  /** 唯一命令通道。 */
  cmd: <T = unknown>(
    command: string,
    params?: unknown,
  ): Promise<CommandResponse<T>> => ipcRenderer.invoke(CH_CMD, command, params),

  /** 启动 / 重连握手。 */
  sync: (): Promise<WorkSyncResult> => ipcRenderer.invoke(CH_SYNC),

  onEvent: (cb: (frame: PiEventFrame) => void): (() => void) => {
    const listener = (_e: unknown, frame: PiEventFrame): void => cb(frame);
    ipcRenderer.on(CH_EVENT, listener);
    return () => ipcRenderer.removeListener(CH_EVENT, listener);
  },
  onState: (cb: (snapshot: ShellSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, snapshot: ShellSnapshot): void =>
      cb(snapshot);
    ipcRenderer.on(CH_STATE, listener);
    return () => ipcRenderer.removeListener(CH_STATE, listener);
  },
  onViews: (cb: (views: ViewEntry[]) => void): (() => void) => {
    const listener = (_e: unknown, views: ViewEntry[]): void => cb(views);
    ipcRenderer.on(CH_VIEW, listener);
    return () => ipcRenderer.removeListener(CH_VIEW, listener);
  },
  /** 订阅一个资源（传空取消）；变更经 onUra 推送。 */
  watchUra: (ref?: string): Promise<{ ref: string } | null> =>
    ipcRenderer.invoke(CH_URA_WATCH, ref ?? ''),
  onUra: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown): void => cb(event);
    ipcRenderer.on(CH_URA, listener);
    return () => ipcRenderer.removeListener(CH_URA, listener);
  },
  onResources: (cb: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown): void => cb(event);
    ipcRenderer.on(CH_RESOURCES, listener);
    return () => ipcRenderer.removeListener(CH_RESOURCES, listener);
  },
  onBus: (
    cb: (message: { viewId: string; message: unknown }) => void,
  ): (() => void) => {
    const listener = (
      _e: unknown,
      message: { viewId: string; message: unknown },
    ): void => cb(message);
    ipcRenderer.on(CH_BUS, listener);
    return () => ipcRenderer.removeListener(CH_BUS, listener);
  },
  onUi: (cb: (request: UiRequest) => void): (() => void) => {
    const listener = (_e: unknown, request: UiRequest): void => cb(request);
    ipcRenderer.on(CH_UI, listener);
    return () => ipcRenderer.removeListener(CH_UI, listener);
  },
  onPopupSelect: (
    cb: (event: { source: string; actionId: string }) => void,
  ): (() => void) => {
    const listener = (
      _e: unknown,
      event: { source: string; actionId: string },
    ): void => cb(event);
    ipcRenderer.on(CH_POPUP_SELECT, listener);
    return () => ipcRenderer.removeListener(CH_POPUP_SELECT, listener);
  },
  onInteraction: (cb: (update: { preview: unknown }) => void): (() => void) => {
    const listener = (_e: unknown, update: { preview: unknown }): void =>
      cb(update);
    ipcRenderer.on(CH_INTERACTION_UPDATE, listener);
    return () => ipcRenderer.removeListener(CH_INTERACTION_UPDATE, listener);
  },

  interaction: {
    begin: (input: InteractionBeginInput): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CH_INTERACTION, 'begin', input),
    move: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CH_INTERACTION, 'move'),
    end: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CH_INTERACTION, 'end'),
    cancel: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CH_INTERACTION, 'cancel'),
  },

  ui: {
    respond: (response: UiDialogResponse): Promise<CommandResponse> =>
      ipcRenderer.invoke(CH_CMD, 'ui.respond', { response }),
  },

  shell: {
    openPath: (target: string): Promise<string> =>
      ipcRenderer.invoke(CH_SHELL, 'openPath', { path: target }),
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CH_SHELL, 'openExternal', { url }),
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(CH_SHELL, 'pickDirectory'),
    showPopup: (input: {
      source: string;
      items: Array<{ id: string; label: string; disabled?: boolean }>;
    }): Promise<boolean> => ipcRenderer.invoke(CH_SHELL, 'popup.show', input),
    closePopup: (): Promise<boolean> =>
      ipcRenderer.invoke(CH_SHELL, 'popup.close'),
  },
};

/** 旧渲染层兼容桥（过渡期；新代码一律 window.workbench）。 */
const legacy = {
  platform: process.platform,
  versions: process.versions as unknown as Record<string, string>,
  openPath: (target: string) =>
    ipcRenderer.invoke(CH_SHELL, 'openPath', { path: target }),
};

/** 原生菜单（弹出层唯一通道）：渲染层不绘制跨内容面的 DOM 菜单（必被原生视图遮挡）。 */
const popupMenu = {
  show: (input: { source: string; items: PopupMenuItem[] }): Promise<void> =>
    ipcRenderer.invoke(CH_SHELL, 'popup.show', input) as Promise<void>,
  close: (): Promise<void> =>
    ipcRenderer.invoke(CH_SHELL, 'popup.close') as Promise<void>,
  count: (): Promise<number> =>
    ipcRenderer.invoke(CH_SHELL, 'popup.count') as Promise<number>,
  onSelect: (cb: (e: PopupSelectEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: PopupSelectEvent): void => cb(event);
    ipcRenderer.on(CH_POPUP_SELECT, listener);
    return () => ipcRenderer.removeListener(CH_POPUP_SELECT, listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('workbench', api);
  contextBridge.exposeInMainWorld('electronAPI', legacy);
  contextBridge.exposeInMainWorld('popupMenu', popupMenu);
} else {
  const w = window as unknown as {
    workbench: unknown;
    electronAPI: unknown;
    popupMenu: unknown;
  };
  w.workbench = api;
  w.electronAPI = legacy;
  w.popupMenu = popupMenu;
}
