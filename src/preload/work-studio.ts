/**
 * 目标架构 preload：window.workStudio 的 subscribe / command / notify。
 *
 * 不提供 call / send / watch 兼容面；切换时 renderer 直接使用原三动词。
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  CallResult,
  DomainUpdate,
  WorkStudioBridge,
} from '@work-studio/sdk';
import { BRIDGE_CHANNELS, workspaceIdOfArgv } from '../shared/channels.ts';

function argvOf(): readonly string[] {
  try {
    // sandbox preload 里 process 可能没有 argv；拿不到就当未注入。
    return typeof process === 'undefined' || !Array.isArray(process.argv)
      ? []
      : process.argv;
  } catch {
    return [];
  }
}

const workspaceId = workspaceIdOfArgv(argvOf());

/**
 * 取数面直接落到工作区搜索资源：与助手 ls / find / read / grep 同一份实现，
 * 页面不需要自己拼 transport。
 */
function access<T>(action: string, input: unknown): Promise<T> {
  if (!workspaceId) return Promise.reject(new Error('工作区未就绪'));
  return ipcRenderer
    .invoke(
      BRIDGE_CHANNELS.command,
      'workspace',
      `${workspaceId}/search`,
      action,
      input,
    )
    .then((result: CallResult<T>) => {
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    });
}

const bridge: WorkStudioBridge = {
  workspaceId,
  ls: (ref, options) => access('ls', { ref, ...options }),
  find: (ref, query) => access('find', { ref, query }),
  read: (ref, options) => access('read', { ref, ...options }),
  grep: (ref, query) => access('grep', { ref, query }),

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

  fileToken: (file) =>
    ipcRenderer.invoke(
      BRIDGE_CHANNELS.fileToken,
      webUtils.getPathForFile(file),
      file.name,
    ),

  onUpdate: (listener) => {
    const handler = (_event: unknown, update: DomainUpdate): void => {
      listener(update);
    };
    ipcRenderer.on(BRIDGE_CHANNELS.update, handler);
    return () => ipcRenderer.removeListener(BRIDGE_CHANNELS.update, handler);
  },
};

contextBridge.exposeInMainWorld('workStudio', bridge);
