/**
 * 插件扩展页 preload —— appBridge 数据面 + 视图总线。
 *
 * 页面只通过 window.appBridge.call/peek 访问主进程；window.extension 仅保留
 * 资源页面会话与内容总线契约。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import scrollbarCss from '../shared/styles/scrollbar.css?raw';
import settingsCss from '../shared/styles/settings.css?raw';
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

/** 统一内置设置页导航；页面继续拥有各自的数据与保存行为。 */
function installSettingsNavigation(): void {
  const match = decodeURIComponent(location.pathname).match(
    /\/settings\/([^/]+)\/index\.html$/,
  );
  const page = match?.[1];
  if (!page || page === 'welcome' || page === 'sessions') return;
  const capability = ['plugins', 'skills', 'extensions'].includes(page);
  const items = capability
    ? [
        ['plugins', '文档插件'],
        ['skills', '技能'],
        ['extensions', '助手扩展'],
      ]
    : [
        ['appearance', '外观与皮肤'],
        ['preferences', '偏好设置'],
        ['models', '模型连接'],
        ['workspaces', '工作区'],
        ['browser', '网站采集'],
        ['storage', '存储与数据'],
        ['resources', '资源诊断'],
        ['updates', '关于与更新'],
      ];
  const nav = document.createElement('nav');
  nav.className = 'ws-settings-navigation';
  nav.setAttribute('aria-label', capability ? '能力管理分类' : '设置分类');
  const title = document.createElement('strong');
  title.textContent = capability ? '能力管理' : '设置';
  nav.append(title);
  for (const [id, label] of items) {
    const button = document.createElement('button');
    button.textContent = label!;
    if (id === page) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      void appBridgeApi.call('/settings/open', { pageId: id });
    });
    nav.append(button);
  }
  document.body.classList.add('ws-settings-page');
  document.body.prepend(nav);
  const style = document.createElement('style');
  style.textContent = settingsCss;
  document.head.append(style);
}
document.addEventListener('DOMContentLoaded', installSettingsNavigation, {
  once: true,
});

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
      void appBridgeApi.call('/views/self/action', { action: 'save' });
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
      void appBridgeApi.call('/views/self/reload').then((r) => {
        if (!r.ok) {
          documentSaveError = r.error.message;
          renderDocumentBar();
        }
      });
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
