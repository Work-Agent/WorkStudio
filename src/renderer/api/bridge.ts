/**
 * 渲染层 API 桥 —— 统一访问 preload 暴露的 IPC 桥。
 *
 * preload 未暴露对应能力时（页面独立开发阶段）回退到本地 mock，
 * 业务代码只 import 本模块，不直接触碰 window.*。
 */
import type {
  ElectronAPI,
  PiBridgeAPI,
  PopupMenuAPI,
  WorkAPI,
} from '../../shared/types';
import {
  createMockAgentAPI,
  createMockPiAPI,
  createMockPopupMenu,
} from './mock';

function guessPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'darwin';
  if (ua.includes('win')) return 'win32';
  return 'linux';
}

const nativeElectron = window.electronAPI;
const hasNativeBridge = Boolean(window.agentAPI && window.piAPI);

if (!hasNativeBridge) {
  console.info(
    '[work-studio] 使用本地 mock 数据层（preload 未暴露 agentAPI/piAPI）',
  );
}

export const isMock = !hasNativeBridge;

export const agentAPI: WorkAPI = window.agentAPI ?? createMockAgentAPI();

export const piAPI: PiBridgeAPI = window.piAPI ?? createMockPiAPI();

export const popupMenu: PopupMenuAPI =
  window.popupMenu ?? createMockPopupMenu();

export const electronAPI: ElectronAPI = nativeElectron ?? {
  platform: guessPlatform(),
  openPath: (path) => Promise.resolve(path),
};
