/** 统一应用视图 preload：shell / assistant / overlay / settings 只暴露 workStudio。 */
import { contextBridge, ipcRenderer } from 'electron';

const CHANNELS = {
  subscribe: 'workstudio:subscribe',
  unsubscribe: 'workstudio:unsubscribe',
  command: 'workstudio:command',
  notify: 'workstudio:notify',
  update: 'workstudio:update',
} as const;

const bridge = {
  subscribe: (domain: string, resource: string): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.subscribe, domain, resource),
  unsubscribe: (domain: string, resource: string): void => {
    ipcRenderer.send(CHANNELS.unsubscribe, domain, resource);
  },
  command: (
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<unknown> =>
    ipcRenderer.invoke(CHANNELS.command, domain, resource, action, input),
  notify: (
    domain: string,
    resource: string,
    action: string,
    value?: unknown,
  ): void => {
    ipcRenderer.send(CHANNELS.notify, domain, resource, action, value);
  },
  onUpdate: (cb: (update: unknown) => void): (() => void) => {
    const listener = (_e: unknown, update: unknown): void => cb(update);
    ipcRenderer.on(CHANNELS.update, listener);
    return () => ipcRenderer.removeListener(CHANNELS.update, listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('workStudio', bridge);
} else {
  (window as unknown as { workStudio: unknown }).workStudio = bridge;
}
