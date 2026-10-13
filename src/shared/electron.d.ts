import type {
  AgentStatus,
  ElectronAPI,
  PiBridgeAPI,
  PopupMenuAPI,
  WorkAPI,
} from './types';

declare global {
  interface Window {
    /** preload 桥（未暴露时渲染层 api/bridge 走 mock）。 */
    electronAPI?: ElectronAPI;
    agentAPI?: WorkAPI;
    piAPI?: PiBridgeAPI;
    popupMenu?: PopupMenuAPI;
  }
}

export type { AgentStatus };
