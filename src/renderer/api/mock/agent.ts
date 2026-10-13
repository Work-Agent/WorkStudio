/**
 * Mock WorkAPI —— uiState（localStorage 持久化）/ 资源 / 插件 / 扩展实例。
 * 真实主进程 IPC 就绪后由 preload 桥替换。
 */
import type {
  AgentStatus,
  ExtensionInstance,
  UiState,
  WorkAPI,
} from '../../../shared/types';
import {
  demoContents,
  demoDocuments,
  demoExtensionDefs,
  demoGroups,
  demoPlugins,
  demoSkills,
  demoWorkspace,
} from './data';

export const UI_STATE_KEY = 'work-studio.ui-state.v1';

export const DEFAULT_UI_STATE: UiState = {
  __version__: 1,
  theme: 'dark',
  aiOpen: true,
  aiFloating: false,
  sidebarView: 'main',
  sidebarDomain: null,
  sidebarCollapsed: false,
  panelCollapsed: false,
  inputExpanded: false,
  selectedSkills: [],
  paneWidths: { left: 240, right: 420 },
  activePath: null,
  openPaths: [],
};

function loadPersisted(): UiState {
  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY);
    if (raw)
      return { ...DEFAULT_UI_STATE, ...(JSON.parse(raw) as Partial<UiState>) };
  } catch {
    /* ignore corrupt storage */
  }
  return { ...DEFAULT_UI_STATE };
}

export function createMockAgentAPI(): WorkAPI {
  // ── uiState（主进程 ui-state.json 的等价物：localStorage + 广播） ──
  let uiState = loadPersisted();
  const uiListeners = new Set<(state: UiState) => void>();
  const persist = (): void => {
    uiState = {
      ...uiState,
      __version__: 1,
      paneWidths: { ...uiState.paneWidths },
    };
    try {
      window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiState));
    } catch {
      /* ignore quota errors */
    }
  };

  // ── agent 运行配置（内存态；configure 即时生效） ──
  let status: AgentStatus = {
    configured: true,
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    thinkingLevel: 'medium',
    workspacePath: demoWorkspace,
  };
  let workspaceIndex = 0;
  const workspaceOptions = [demoWorkspace, '/Users/qingo/Projects/Beta-Labs'];

  // ── 扩展实例（内存表：真实版由主进程 WebContentsView 承载） ──
  const instances: ExtensionInstance[] = [];
  let instanceSeq = 0;

  return {
    uiState: {
      get: () => Promise.resolve({ ...uiState }),
      set: (patch) => {
        uiState = { ...uiState, ...patch };
        persist();
        for (const listener of uiListeners) listener({ ...uiState });
        return Promise.resolve({ ...uiState });
      },
      onChanged: (cb) => {
        uiListeners.add(cb);
        return () => uiListeners.delete(cb);
      },
    },

    status: () => Promise.resolve({ ...status }),
    models: () =>
      Promise.resolve([
        {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
        },
        {
          provider: 'anthropic',
          modelId: 'claude-opus-4-1',
          label: 'Claude Opus 4.1',
        },
        {
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
          label: 'Claude Haiku 4.5',
        },
        { provider: 'openai', modelId: 'gpt-5', label: 'GPT-5' },
        { provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 mini' },
      ]),
    configure: (input) => {
      status = {
        ...status,
        ...input,
        configured: Boolean(
          status.provider ?? input.provider ?? status.modelId ?? input.modelId,
        ),
      };
      return Promise.resolve({ ...status });
    },
    setWorkspace: (path) => {
      status = { ...status, workspacePath: path };
      return Promise.resolve({ ...status });
    },
    pickWorkspace: () => {
      workspaceIndex = (workspaceIndex + 1) % workspaceOptions.length;
      return Promise.resolve(workspaceOptions[workspaceIndex]);
    },

    documents: {
      list: () => Promise.resolve(demoDocuments.map((d) => ({ ...d }))),
      groups: () => Promise.resolve(demoGroups.map((g) => ({ ...g }))),
      open: (docId) => {
        const meta = demoDocuments.find((d) => d.id === docId);
        const content = demoContents[docId];
        if (!meta || !content) return Promise.resolve(null);
        return Promise.resolve({ meta: { ...meta }, content: { ...content } });
      },
      update: (docId, content) => {
        const idx = demoDocuments.findIndex((d) => d.id === docId);
        if (idx < 0) return Promise.resolve(null);
        demoDocuments[idx] = { ...demoDocuments[idx], updatedAt: Date.now() };
        demoContents[docId] = { ...demoContents[docId], content };
        return Promise.resolve({ ...demoDocuments[idx] });
      },
      search: () => Promise.resolve([]),
      onRefresh: () => () => undefined,
    },

    plugins: {
      list: () => Promise.resolve(demoPlugins.map((p) => ({ ...p }))),
    },
    skills: {
      list: () => Promise.resolve(demoSkills.map((s) => ({ ...s }))),
    },

    extensions: {
      definitions: () =>
        Promise.resolve(demoExtensionDefs.map((d) => ({ ...d }))),
      getOrCreate: (extensionId, opts) => {
        const existing = opts?.documentId
          ? instances.find((i) => i.documentId === opts.documentId)
          : instances.find(
              (i) => i.extensionId === extensionId && i.documentId === null,
            );
        if (existing) return Promise.resolve(existing.instanceId);

        const def = demoExtensionDefs.find((d) => d.id === extensionId);
        const instanceId = `inst-${++instanceSeq}`;
        instances.push({
          instanceId,
          extensionId,
          label: opts?.label ?? def?.label ?? extensionId,
          url:
            opts?.url ??
            (opts?.documentId
              ? `app://doc/${opts.documentId}`
              : `app://plugin/${def?.pluginId ?? 'unknown'}`),
          documentId: opts?.documentId ?? null,
          visible: false,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          pluginId: def?.pluginId ?? 'unknown',
          loaded: true,
          raw: opts?.raw === true,
        });
        return Promise.resolve(instanceId);
      },
      destroy: (instanceId) => {
        const idx = instances.findIndex((i) => i.instanceId === instanceId);
        if (idx >= 0) instances.splice(idx, 1);
        return Promise.resolve();
      },
      setActive: (instanceId) => {
        for (const inst of instances)
          inst.visible = inst.instanceId === instanceId;
        return Promise.resolve();
      },
      reload: () => Promise.resolve(),
      list: () => Promise.resolve(instances.map((i) => ({ ...i }))),
      syncBounds: (instanceId, bounds) => {
        const inst = instances.find((i) => i.instanceId === instanceId);
        if (inst) inst.bounds = { ...bounds };
        return Promise.resolve();
      },
      sendToView: () => Promise.resolve(),
      broadcast: () => Promise.resolve(),
      navigate: () => Promise.resolve(),
      goBack: () => Promise.resolve(),
      goForward: () => Promise.resolve(),
      setInteractiveElements: (_id, on) => Promise.resolve(on),
    },

    browser: {
      onRefClick: () => () => undefined,
    },
  };
}
