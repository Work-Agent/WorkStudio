/**
 * 网页标签的受限 preload：只暴露 `workStudio.command`，没有订阅、没有通知。
 *
 * 授权页（例如供应商的登录页）登录成功后调用：
 *   window.workStudio.command('agent','providers','completeLogin',{ providerId, accessToken })
 * 主进程按「页面来源域名 = 供应商域名」校验，通过后才写入凭证。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { CallResult } from '@work-studio/sdk';

// 通道字符串就地写死：sandbox preload 不能 require 相对路径，
// 多入口共享模块会被拆成 chunks，反而加载失败（见 electron.vite.config.ts）。
const COMMAND_CHANNEL = 'workstudio:command';

interface WebBridge {
  command: <T = unknown>(
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ) => Promise<CallResult<T>>;
}

const bridge: WebBridge = {
  command: (domain, resource, action, input) =>
    ipcRenderer.invoke(COMMAND_CHANNEL, domain, resource, action, input),
};

contextBridge.exposeInMainWorld('workStudio', bridge);
