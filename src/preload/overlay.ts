/**
 * 浮层视图 preload —— 对话框请求订阅 + 结构化应答（ui.respond）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { APP_CMD, CH_UI } from '../shared/channels';
import type { AppCommand } from '../shared/app';
import type {
  CommandResponse,
  UiDialogResponse,
  UiRequest,
} from '../shared/types';

const api = {
  onUi: (cb: (request: UiRequest) => void): (() => void) => {
    const listener = (_e: unknown, request: UiRequest): void => cb(request);
    ipcRenderer.on(CH_UI, listener);
    return () => ipcRenderer.removeListener(CH_UI, listener);
  },
  respond: (response: UiDialogResponse): Promise<CommandResponse> =>
    ipcRenderer.invoke(APP_CMD, {
      scope: 'ui',
      action: 'ui.respond',
      payload: { response },
    } satisfies AppCommand),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('overlay', api);
} else {
  (window as unknown as { overlay: unknown }).overlay = api;
}
