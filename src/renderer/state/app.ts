/**
 * App 作用域 store（zustand）—— 应用级模型目录、工作区目录与运行状态投影。
 *
 * 真相源在主进程：快照经 `app.sync` 水合，工作区切换走 `agent.setWorkspace`。
 *
 * 铁律：渲染层不伪造默认值——初始形态 = 「未配置」，真实状态由 init() 首拉注入。
 */
import { create } from 'zustand';
import type {
  AgentSnapshot,
  AgentStatus,
  ModelOption,
  WorkspaceInfo,
} from '../../shared/types';

const mainBridge = typeof window !== 'undefined' ? window.workbench : undefined;

/** AgentSnapshot → AgentStatus（渲染层配置投影子集）。 */
export function toAgentStatus(s: AgentSnapshot): AgentStatus {
  return {
    configured: s.configured,
    ...(s.provider ? { provider: s.provider } : {}),
    ...(s.modelId ? { modelId: s.modelId } : {}),
    ...(s.thinkingLevel ? { thinkingLevel: s.thinkingLevel } : {}),
    ...(s.workspacePath ? { workspacePath: s.workspacePath } : {}),
  };
}

interface AppState {
  status: AgentStatus;
  models: ModelOption[];
  workspaces: WorkspaceInfo[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
}

export const useAppStore = create<AppState>()((set, get) => ({
  /** 未配置态（不携带任何伪造的 provider/model 值）。 */
  status: { configured: false },
  models: [],
  workspaces: [],

  refresh: async () => {
    const r = await mainBridge!.cmd<AgentSnapshot>('agent.status');
    if (r.ok) set({ status: toAgentStatus(r.data) });
  },

  refreshWorkspaces: async () => {
    const r = await mainBridge!.cmd<WorkspaceInfo[]>('agent.workspaces');
    if (r.ok) set({ workspaces: r.data });
  },

  init: async () => {
    const [models, status] = await Promise.all([
      mainBridge!.cmd<ModelOption[]>('agent.models'),
      mainBridge!.cmd<AgentSnapshot>('agent.status'),
    ]);
    set({
      models: models.ok ? models.data : [],
      status: status.ok ? toAgentStatus(status.data) : { configured: false },
    });
    void get().refreshWorkspaces();
    window.addEventListener('focus', () => {
      void get().refresh();
    });
  },

  /** 工作区切换（独立通道，不经模型配置）：重绑资源域/会话域/技能。 */
  switchWorkspace: async (path) => {
    const r = await mainBridge!.cmd<AgentSnapshot>('agent.setWorkspace', {
      path,
    });
    if (!r.ok) throw new Error(r.error.message);
    set({ status: toAgentStatus(r.data) });
    await get().refreshWorkspaces();
  },
}));
