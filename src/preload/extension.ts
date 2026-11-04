/**
 * 插件扩展页 preload —— appBridge 数据面 + 视图总线。
 *
 * 页面只通过 window.appBridge.call/peek 访问主进程；window.extension 仅保留
 * 资源页面会话与内容总线契约。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import scrollbarCss from '../shared/styles/scrollbar.css?raw';
import { CH_BUS, CH_URA, CH_URA_WATCH } from '../shared/channels';
import type { AppBridge } from '../shared/electron';
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

async function appPeek<T>(path: string): Promise<T | null> {
  return appBridgeApi ? appBridgeApi.peek<T>(path) : null;
}

async function pageCall<T = unknown>(
  suffix: string,
  input?: unknown,
): Promise<T> {
  const workspace = await appPeek<{ id: string }>('/workspaces/current');
  if (!workspace) throw new Error('workspace is not ready');
  const result = await appBridgeApi.call<T>(
    `/workspaces/${workspace.id}/resources/pages${suffix}`,
    input,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const pathRoots = {
  dataRoot: '',
  workspacePath: '',
  workspaceId: '',
  appPath: '',
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 绝对路径 → 相对 dataRoot / workspace 的展示路径。 */
function formatPath(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw) return '';
  let path = raw;
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(path.slice('file://'.length));
    } catch {
      /* keep */
    }
  }
  path = normalizePath(path);
  const roots = [
    ['workspace', normalizePath(pathRoots.workspacePath)],
    ['dataRoot', normalizePath(pathRoots.dataRoot)],
    ['app', normalizePath(pathRoots.appPath)],
  ] as const;
  for (const [label, root] of roots) {
    if (!root) continue;
    if (path === root) return label;
    if (path.startsWith(`${root}/`))
      return `${label}/${path.slice(root.length + 1)}`;
  }
  return path;
}

async function refreshPathRoots(): Promise<void> {
  try {
    const [storage, workspace] = await Promise.all([
      appPeek<{ dataRoot?: string; appPath?: string }>('/settings/storage'),
      appPeek<{ id?: string; path?: string }>('/workspaces/current'),
    ]);
    pathRoots.dataRoot = storage?.dataRoot ?? '';
    pathRoots.appPath = storage?.appPath ?? '';
    pathRoots.workspacePath = workspace?.path ?? '';
    pathRoots.workspaceId = workspace?.id ?? '';
  } catch {
    /* keep previous roots */
  }
}

const pathDisplay = { format: formatPath };

const api = {
  /** 拖放的 File 对象 → 绝对路径（Chromium 已移除 File.path）。 */
  filePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  /** 资源页面契约：会话由主进程持有，页面只拿 id / 入口 / 数据。 */
  ura: {
    page: {
      get: <T = unknown>(id: string): Promise<T> =>
        pageCall(`/${encodeURIComponent(id)}/get`),
      open: <T = unknown>(ref: string): Promise<T> =>
        pageCall('/open', { ref }),
      save: <T = unknown>(id: string, content: string): Promise<T> =>
        pageCall(`/${encodeURIComponent(id)}/save`, { content }),
      /** 二进制保存（OOXML 等）；返回 CommitResult，冲突稿为 base64。 */
      saveBytes: <T = unknown>(id: string, data: Uint8Array): Promise<T> =>
        pageCall(`/${encodeURIComponent(id)}/save`, { content: data }),
      reload: <T = unknown>(id: string): Promise<T> =>
        pageCall(`/${encodeURIComponent(id)}/reload`),
      close: (id: string): Promise<unknown> =>
        pageCall(`/${encodeURIComponent(id)}/close`),
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
  contextBridge.exposeInMainWorld('pathDisplay', pathDisplay);
  contextBridge.exposeInMainWorld('extension', api);
} else {
  (window as unknown as { extension: unknown }).extension = api;
  (window as unknown as { pathDisplay: unknown }).pathDisplay = pathDisplay;
}

/** appBridge 传输桥（单文件 preload 约束：不能跨文件共享 chunk）。 */
const appBridgeImpl = {
  available: (): Promise<boolean> => ipcRenderer.invoke('appBridge:hello'),
  call: (path: string, input?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('appBridge:call', path, input),
  watch: (paths: string[]): Promise<{ granted: string[]; denied: string[] }> =>
    ipcRenderer.invoke('appBridge:watch', paths),
  emit: (path: string, value?: unknown): void => {
    ipcRenderer.send('appBridge:emit', path, value);
  },
  peek: (path: string): Promise<unknown> =>
    ipcRenderer.invoke('appBridge:peek', path),
  on: (cb: (frame: unknown) => void): (() => void) => {
    const listener = (_e: unknown, frame: unknown): void => cb(frame);
    ipcRenderer.on('appBridge:frame', listener);
    return () => ipcRenderer.removeListener('appBridge:frame', listener);
  },
};

const appBridgeApi = appBridgeImpl as unknown as AppBridge;
void refreshPathRoots();
appBridgeApi.on((frame) => {
  if (frame.type !== 'state' || frame.path !== '/workspaces/current') return;
  const workspace = frame.value as { id?: string; path?: string } | null;
  pathRoots.workspacePath = workspace?.path ?? '';
  pathRoots.workspaceId = workspace?.id ?? '';
});

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('appBridge', appBridgeImpl);
} else {
  (window as unknown as { appBridge: unknown }).appBridge = appBridgeImpl;
}
