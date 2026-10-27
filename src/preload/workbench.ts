/**
 * 工作台 preload（contextBridge 白名单桥；不暴露 ipcRenderer）。
 *
 * 语义化 API：cmd / appSync / 订阅（app snapshot / app event / bus / ui / interaction）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_CMD,
  APP_EVENT,
  APP_SNAPSHOT,
  APP_SYNC,
  CH_BUS,
  CH_INTERACTION,
  CH_INTERACTION_UPDATE,
  CH_POPUP_SELECT,
  CH_RESOURCES,
  CH_SHELL,
  CH_UI,
  CH_URA,
  CH_URA_WATCH,
} from '../shared/channels';
import type { AppCommand, AppEvent, AppSnapshot } from '../shared/app';
import { scopeForCommand } from '../shared/command-scope';
import type {
  CommandResponse,
  InteractionBeginInput,
  UiDialogResponse,
  UiRequest,
} from '../shared/types';

const api = {
  platform: process.platform,
  versions: process.versions as unknown as Record<string, string>,
  openPath: (target: string) =>
    ipcRenderer.invoke(CH_SHELL, 'openPath', {
      path: target,
    }) as Promise<string>,

  /** 唯一命令通道（AppCommand）。 */
  cmd: <T = unknown>(
    command: string,
    params?: unknown,
  ): Promise<CommandResponse<T>> =>
    ipcRenderer.invoke(APP_CMD, {
      scope: scopeForCommand(command),
      action: command,
      payload: params,
    } satisfies AppCommand),

  /** AppSnapshot 握手（新渲染层）。 */
  appSync: (): Promise<AppSnapshot> => ipcRenderer.invoke(APP_SYNC),
  onAppSnapshot: (cb: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, snapshot: AppSnapshot): void => cb(snapshot);
    ipcRenderer.on(APP_SNAPSHOT, listener);
    return () => ipcRenderer.removeListener(APP_SNAPSHOT, listener);
  },
  onAppEvent: (cb: (event: AppEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AppEvent): void => cb(event);
    ipcRenderer.on(APP_EVENT, listener);
    return () => ipcRenderer.removeListener(APP_EVENT, listener);
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
      ipcRenderer.invoke(APP_CMD, {
        scope: 'ui',
        action: 'ui.respond',
        payload: { response },
      } satisfies AppCommand),
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

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('workbench', api);
} else {
  const w = window as unknown as { workbench: unknown };
  w.workbench = api;
}
