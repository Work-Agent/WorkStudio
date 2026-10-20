/**
 * raw 网页视图 preload —— 最小桥（页面本身是外部内容，不暴露应用数据面）。
 */
import { contextBridge } from 'electron';

const api = {
  platform: process.platform,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('browser', api);
} else {
  (window as unknown as { browser: unknown }).browser = api;
}
