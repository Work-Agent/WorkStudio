/**
 * 插件扩展页 preload —— 资源页面会话 + 内容总线。
 *
 * 页面只通过 window.extension 访问主进程；preload 内部直接使用 workStudio 的
 * 资源页命令，页面只暴露 window.extension。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import scrollbarCss from '../shared/styles/scrollbar.css?raw';
import { CH_BUS, CH_URA, CH_URA_WATCH } from '../shared/channels.ts';
import type {
  ViewBusMessageFromView,
  ViewBusMessageToView,
} from '../shared/view-bus.ts';

/**
 * 全域滚动条规范注入（单一事实源 shared/styles/scrollbar.css，与主窗口 index.css 同一份）。
 * preload 随文档创建即执行（早于首帧 → 无「注入前那一帧默认滚动条」闪帧），
 * 每次导航自动重跑 = 天然重注入；插件页主题标记为 html[data-theme]。
 */
/**
 * 内容页主题只跟随 prefers-color-scheme：设置页 / 插件页保留 data-theme
 * 作为样式钩子，但数据源是媒体查询，不再依赖主进程推主题帧。
 */
function syncColorScheme(): void {
  if (!document.documentElement) return;
  document.documentElement.dataset.theme = matchMedia(
    '(prefers-color-scheme: dark)',
  ).matches
    ? 'dark'
    : 'light';
}

if (document.documentElement) syncColorScheme();
else
  document.addEventListener('DOMContentLoaded', syncColorScheme, {
    once: true,
  });
matchMedia('(prefers-color-scheme: dark)').addEventListener(
  'change',
  syncColorScheme,
);

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

const WS_COMMAND = 'workstudio:command';
const WS_SUBSCRIBE = 'workstudio:subscribe';
const WS_UPDATE = 'workstudio:update';
const WS_UNSUBSCRIBE = 'workstudio:unsubscribe';
const WS_NOTIFY = 'workstudio:notify';

const workStudio = {
  subscribe: (domain: string, resource: string): Promise<unknown> =>
    ipcRenderer.invoke(WS_SUBSCRIBE, domain, resource),
  unsubscribe: (domain: string, resource: string): void => {
    ipcRenderer.send(WS_UNSUBSCRIBE, domain, resource);
  },
  command: (
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<unknown> =>
    ipcRenderer.invoke(WS_COMMAND, domain, resource, action, input),
  notify: (
    domain: string,
    resource: string,
    action: string,
    value?: unknown,
  ): void => {
    ipcRenderer.send(WS_NOTIFY, domain, resource, action, value);
  },
  onUpdate: (cb: (update: unknown) => void): (() => void) => {
    const listener = (_event: unknown, update: unknown): void => cb(update);
    ipcRenderer.on(WS_UPDATE, listener);
    return () => ipcRenderer.removeListener(WS_UPDATE, listener);
  },
};

async function wsCommand<T>(
  domain: string,
  resource: string,
  action: string,
  input?: unknown,
): Promise<T> {
  const result = await ipcRenderer.invoke(
    WS_COMMAND,
    domain,
    resource,
    action,
    input,
  );
  if (!result?.ok) throw new Error(result?.error?.message ?? 'command failed');
  return result.data as T;
}

async function pageCall<T = unknown>(
  suffix: string,
  input?: unknown,
): Promise<T> {
  const match = /^\/([^/]+)\/(get|save|save-copy|reload|close)$/.exec(suffix);
  if (suffix === '/open') {
    return wsCommand<T>('resources', 'current', 'openPageView', input);
  }
  if (match) {
    const pageId = decodeURIComponent(match[1]!);
    const action = match[2]!;
    if (action === 'get')
      return wsCommand<T>('resources', 'current', 'getPage', { pageId });
    if (action === 'save')
      return wsCommand<T>('resources', 'current', 'savePage', {
        pageId,
        ...(input as Record<string, unknown>),
      });
    if (action === 'save-copy')
      return wsCommand<T>('resources', 'current', 'saveCopy', {
        pageId,
        ...(input as Record<string, unknown>),
      });
    if (action === 'reload')
      return wsCommand<T>('resources', 'current', 'reloadPage', {
        pageId,
        external: false,
      });
    return wsCommand<T>('resources', 'current', 'closePage', { pageId });
  }
  throw new Error(`resource page action not supported: ${suffix}`);
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
    [
      'app/workspace',
      pathRoots.dataRoot && pathRoots.workspaceId
        ? `${normalizePath(pathRoots.dataRoot)}/workspaces/${pathRoots.workspaceId}`
        : '',
    ],
    ['app', normalizePath(pathRoots.dataRoot)],
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

function applyRoots(
  storage: {
    dataRoot?: string;
    appPath?: string;
    workspacePath?: string;
    workspaceId?: string;
  } | null,
  workspace: { id?: string; path?: string } | null,
): void {
  pathRoots.dataRoot = storage?.dataRoot ?? pathRoots.dataRoot;
  pathRoots.appPath = storage?.appPath ?? pathRoots.appPath;
  pathRoots.workspacePath =
    workspace?.path ?? storage?.workspacePath ?? pathRoots.workspacePath;
  pathRoots.workspaceId =
    workspace?.id ?? storage?.workspaceId ?? pathRoots.workspaceId;
}

ipcRenderer.on(WS_UPDATE, (_event, update: unknown) => {
  const value = update as {
    domain?: string;
    resource?: string;
    data?: unknown;
  };
  if (value.domain !== 'settings' || value.resource !== 'storage') return;
  applyRoots(value.data as { dataRoot?: string; appPath?: string }, null);
});

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
      save: async <T = unknown>(id: string, content: string): Promise<T> => {
        try {
          const result = await pageCall<T>(`/${encodeURIComponent(id)}/save`, {
            content,
          });
          ipcRenderer.send(CH_BUS, { type: 'save-result', ok: true });
          documentSaveError = '';
          renderDocumentBar();
          return result;
        } catch (error) {
          documentSaveError =
            error instanceof Error ? error.message : String(error);
          ipcRenderer.send(CH_BUS, {
            type: 'save-result',
            ok: false,
            message: documentSaveError,
          });
          renderDocumentBar();
          throw error;
        }
      },
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
  contextBridge.exposeInMainWorld('workStudio', workStudio);
} else {
  (window as unknown as { extension: unknown }).extension = api;
  (window as unknown as { pathDisplay: unknown }).pathDisplay = pathDisplay;
  (window as unknown as { workStudio: unknown }).workStudio = workStudio;
}

/** 统一内置设置页导航；页面继续拥有各自的数据与保存行为。 */
/** 内置文本资料共用保存反馈；作品 iframe 与外部网页保持自己的外观。 */
let documentSaveError = '';
let documentState = { dirty: false, conflict: false, missing: false };
const resourceSession = new URLSearchParams(location.search).get('session');
function renderDocumentBar(): void {
  if (!resourceSession || !document.body) return;
  let bar = document.getElementById('ws-document-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ws-document-bar';
    const status = document.createElement('span');
    status.id = 'ws-document-status';
    status.setAttribute('role', 'status');
    status.style.flex = '1';
    bar.append(status);
    const add = (label: string, action: () => void): void => {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', action);
      bar!.append(button);
    };
    add('保存', () => {
      ipcRenderer.send(CH_BUS, { type: 'self-action', id: 'save' });
    });
    add('另存副本', () => {
      void (async () => {
        const editor =
          document.querySelector<HTMLTextAreaElement>('#source, #editor');
        if (!editor) {
          documentSaveError = '此编辑器请使用插件自身的另存功能。';
          renderDocumentBar();
          return;
        }
        try {
          const result = await pageCall<{ saved: boolean; ref?: string }>(
            `/${encodeURIComponent(resourceSession)}/save-copy`,
            { content: editor.value },
          );
          if (result.saved) {
            documentSaveError = '草稿副本已保存，原文档编辑仍然保留。';
            renderDocumentBar();
          }
        } catch (error) {
          documentSaveError =
            error instanceof Error ? error.message : String(error);
          renderDocumentBar();
        }
      })();
    });
    add('重新读取', () => {
      ipcRenderer.send(CH_BUS, { type: 'self-reload' });
    });
    document.body.prepend(bar);
    const style = document.createElement('style');
    style.textContent =
      '#ws-document-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--panel);color:var(--fg);font:12px/1.6 -apple-system,sans-serif;flex:none}#ws-document-bar button{font:inherit;color:inherit;border:1px solid var(--border);background:var(--bg);padding:3px 8px;border-radius:5px;cursor:pointer}#ws-document-bar[data-warning=true]{border-left:3px solid var(--warn)}';
    document.head.append(style);
  }
  const status = document.getElementById('ws-document-status');
  if (status)
    status.textContent =
      documentSaveError ||
      (documentState.missing
        ? '文件无法访问，草稿仍保留，可另存副本。'
        : documentState.conflict
          ? '外部文件已修改。请保留草稿副本，或放弃修改后重新读取。'
          : documentState.dirty
            ? '● 未保存'
            : '✓ 已保存');
  bar.dataset.warning = String(
    Boolean(
      documentSaveError || documentState.missing || documentState.conflict,
    ),
  );
}
ipcRenderer.on(
  CH_BUS,
  (
    _event,
    message: {
      type: string;
      dirty?: boolean;
      conflict?: boolean;
      missing?: boolean;
    },
  ) => {
    if (message.type === 'document-state') {
      documentState = {
        dirty: Boolean(message.dirty),
        conflict: Boolean(message.conflict),
        missing: Boolean(message.missing),
      };
      renderDocumentBar();
    }
    if (message.type === 'content') {
      documentSaveError = '';
      renderDocumentBar();
    }
  },
);
document.addEventListener('DOMContentLoaded', renderDocumentBar, {
  once: true,
});
