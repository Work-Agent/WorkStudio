import { contextBridge, ipcRenderer } from 'electron';

// 主窗口 preload：目前只暴露平台信息与 shell 能力。
// 领域 API（agentAPI / piAPI / popupMenu）待主进程服务就绪后在此桥接；
// 渲染层 api/bridge.ts 在缺失时自动回退到本地 mock（页面可独立运行）。
const api = {
  platform: process.platform,
  versions: process.versions as unknown as Record<string, string>,
  openPath: (path: string) =>
    ipcRenderer.invoke('shell:openPath', path) as Promise<string | null>,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', api);
} else {
  window.electronAPI = api;
}
