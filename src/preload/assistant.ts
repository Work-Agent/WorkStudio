/**
 * AI 助手视图 preload —— 最小能力面：会话命令子集 + 事件流 + 交互（移动/缩放）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_EVENT,
  APP_SNAPSHOT,
  APP_SYNC,
  CH_CMD,
  CH_INTERACTION,
  CH_INTERACTION_UPDATE,
  CH_POPUP_SELECT,
  CH_SHELL,
} from '../shared/channels';
import type { AppEvent, AppSnapshot } from '../shared/app';
import type {
  CommandResponse,
  InteractionBeginInput,
  UiDialogResponse,
} from '../shared/types';

const api = {
  platform: process.platform,
  cmd: <T = unknown>(
    command: string,
    params?: unknown,
  ): Promise<CommandResponse<T>> => ipcRenderer.invoke(CH_CMD, command, params),
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
  shell: {
    showPopup: (input: {
      source: string;
      items: Array<{ id: string; label: string; disabled?: boolean }>;
    }): Promise<boolean> => ipcRenderer.invoke(CH_SHELL, 'popup.show', input),
    closePopup: (): Promise<boolean> =>
      ipcRenderer.invoke(CH_SHELL, 'popup.close'),
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('assistant', api);
} else {
  (window as unknown as { assistant: unknown }).assistant = api;
}
