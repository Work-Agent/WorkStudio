/**
 * 插件扩展页 preload —— 数据面（app:* 白名单命令）+ 视图总线。
 *
 * 扩展页无 node 能力：window.extension.invoke(cmd, payload) 直连主进程
 * （渲染层不中转数据）；就绪握手与内容投递经类型化总线。
 */
import { contextBridge, ipcRenderer } from 'electron';
import scrollbarCss from '../shared/styles/scrollbar.css?raw';
import { CH_BUS, CH_EXT, CH_URA, CH_URA_WATCH } from '../shared/channels';
import type { CommandResponse } from '../shared/types';
import type {
  ViewBusMessageFromView,
  ViewBusMessageToView,
} from '../shared/view-bus';

/**
 * 全域滚动条规范注入（单一事实源 shared/styles/scrollbar.css，与主窗口 index.css 同一份）。
 * preload 随文档创建即执行（早于首帧 → 无「注入前那一帧默认滚动条」闪帧），
 * 每次导航自动重跑 = 天然重注入；插件页主题标记为 html[data-theme]。
 */
function injectScrollbarCss(): void {
  const apply = (): void => {
    if (
      !document.documentElement ||
      document.getElementById('ws-scrollbar-css')
    )
      return;
    const style = document.createElement('style');
    style.id = 'ws-scrollbar-css';
    style.textContent = scrollbarCss;
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.documentElement) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
}

injectScrollbarCss();

const api = {
  /** 白名单数据面（app:agent.* / app:models.* / app:settings.* / app:ura.* / app:views.* / app:plugins.list）。 */
  invoke: <T = unknown>(cmd: string, payload?: unknown): Promise<T> =>
    ipcRenderer
      .invoke(CH_EXT, cmd, payload)
      .then((response: CommandResponse<T>) => {
        if (!response.ok) throw new Error(response.error.message);
        return response.data;
      }),
  /** 资源页面契约：会话由主进程持有，页面只拿 id / 入口 / 数据。 */
  ura: {
    page: {
      get: <T = unknown>(id: string): Promise<T> =>
        api.invoke('app:ura.page.get', { id }),
      open: <T = unknown>(ref: string): Promise<T> =>
        api.invoke('app:ura.page.open', { ref }),
      save: <T = unknown>(id: string, content: string): Promise<T> =>
        api.invoke('app:ura.page.save', { id, content }),
      reload: <T = unknown>(id: string): Promise<T> =>
        api.invoke('app:ura.page.reload', { id }),
      close: (id: string): Promise<unknown> =>
        api.invoke('app:ura.page.close', { id }),
    },
    /** 订阅资源变更（传空取消）。 */
    watch: (ref?: string): Promise<{ ref: string } | null> =>
      ipcRenderer.invoke(CH_URA_WATCH, ref ?? ''),
    onChange: (cb: (event: unknown) => void): (() => void) => {
      const listener = (_e: unknown, event: unknown): void => cb(event);
      ipcRenderer.on(CH_URA, listener);
      return () => ipcRenderer.removeListener(CH_URA, listener);
    },
  },
  bus: {
    /** 订阅主进程下发（content / theme / action / mode）。 */
    on: (cb: (message: ViewBusMessageToView) => void): (() => void) => {
      const listener = (_e: unknown, message: ViewBusMessageToView): void =>
        cb(message);
      ipcRenderer.on(CH_BUS, listener);
      return () => ipcRenderer.removeListener(CH_BUS, listener);
    },
    /** 上报（loaded / dirty / actionState / navigate / refClick / log）。 */
    send: (message: ViewBusMessageFromView): void => {
      ipcRenderer.send(CH_BUS, message);
    },
    /** 就绪握手（内容投递门控解除）。 */
    loaded: (): void => {
      ipcRenderer.send(CH_BUS, {
        type: 'loaded',
      } satisfies ViewBusMessageFromView);
    },
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('extension', api);
} else {
  (window as unknown as { extension: unknown }).extension = api;
}
