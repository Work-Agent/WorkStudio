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
import { BRIDGE_CHANNELS, INITIAL_THEME_CHANNEL } from '../shared/channels.ts';

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

/** 所有系统视图共享同一主题投影；CSS 用 .dark / prefers-color-scheme 统一消费。 */
function paintTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (!root) return;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#1a1c1d' : '#f4f4f5';
}

function applyTheme(state: unknown): void {
  const theme =
    typeof state === 'object' &&
    state !== null &&
    (state as { theme?: unknown }).theme === 'dark'
      ? 'dark'
      : 'light';
  paintTheme(theme);
}

// 首帧前同步取一次主题：避免页面 CSS 加载前的白色闪烁。
try {
  const initial = ipcRenderer.sendSync(INITIAL_THEME_CHANNEL) as {
    theme?: unknown;
  } | null;
  paintTheme(initial?.theme === 'dark' ? 'dark' : 'light');
} catch {
  /* bridge 尚未就绪时由后续订阅修正 */
}

window.addEventListener('DOMContentLoaded', () => {
  void bridge.subscribe('shell', 'appearance').then(applyTheme);
  bridge.onUpdate((update) => {
    if (update.domain === 'shell' && update.resource === 'appearance') {
      applyTheme(update.data);
    }
  });
});
