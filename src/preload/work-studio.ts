/**
 * 目标架构 preload：window.workStudio 的 subscribe / command / notify。
 *
 * 不提供 call / send / watch 兼容面；切换时 renderer 直接使用原三动词。
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  CallResult,
  DomainUpdate,
  WorkStudioBridge,
} from '@workstudio/sdk';
import { BRIDGE_CHANNELS } from '../shared/channels.ts';

const bridge: WorkStudioBridge = {
  subscribe: (domain, resource) =>
    ipcRenderer.invoke(BRIDGE_CHANNELS.subscribe, domain, resource),

  unsubscribe: (domain, resource) => {
    ipcRenderer.send(BRIDGE_CHANNELS.unsubscribe, domain, resource);
  },

  command: <T = unknown>(
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<CallResult<T>> =>
    ipcRenderer.invoke(
      BRIDGE_CHANNELS.command,
      domain,
      resource,
      action,
      input,
    ),

  notify: (domain, resource, action, value) => {
    ipcRenderer.send(BRIDGE_CHANNELS.notify, domain, resource, action, value);
  },

  onUpdate: (listener) => {
    const handler = (_event: unknown, update: DomainUpdate): void => {
      listener(update);
    };
    ipcRenderer.on(BRIDGE_CHANNELS.update, handler);
    return () => ipcRenderer.removeListener(BRIDGE_CHANNELS.update, handler);
  },
};

contextBridge.exposeInMainWorld('workStudio', bridge);
