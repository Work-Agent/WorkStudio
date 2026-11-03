/**
 * AI 助手视图 preload —— 仅暴露 appBridge 传输桥。
 */
import { contextBridge, ipcRenderer } from 'electron';

const appBridge = {
  available: (): Promise<boolean> => ipcRenderer.invoke('appBridge:hello'),
  call: (path: string, input?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('appBridge:call', path, input),
  watch: (paths: string[]): Promise<{ granted: string[]; denied: string[] }> =>
    ipcRenderer.invoke('appBridge:watch', paths),
  emit: (path: string, value?: unknown): void => {
    ipcRenderer.send('appBridge:emit', path, value);
  },
  peek: (path: string): Promise<unknown> =>
    ipcRenderer.invoke('appBridge:peek', path),
  on: (cb: (frame: unknown) => void): (() => void) => {
    const listener = (_e: unknown, frame: unknown): void => cb(frame);
    ipcRenderer.on('appBridge:frame', listener);
    return () => ipcRenderer.removeListener('appBridge:frame', listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('appBridge', appBridge);
} else {
  (window as unknown as { appBridge: unknown }).appBridge = appBridge;
}
