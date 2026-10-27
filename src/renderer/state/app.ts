/**
 * 配置域 store（zustand）—— Agent 运行配置的渲染层投影。
 *
 * 真相源在主进程（默认 provider/model 解析；目录 = pi 组合目录）：status 快照经
 * `app.sync` / `agent.status` 与 `agent_status_changed` 事件收敛；configure 增量提交
 * 即时生效（模型/思考切换器与模型设置页同源）。
 *
 * 铁律：渲染层不伪造默认值——初始形态 = 「未配置」，真实状态由 init() 首拉注入。
 */
import { create } from 'zustand';
import type {
  AgentConfigureInput,
  AgentSnapshot,
  AgentStatus,
  ModelOption,
  SkillInfo,
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

interface AgentConfigState {
  status: AgentStatus;
  models: ModelOption[];
  skills: SkillInfo[];
  workspaces: WorkspaceInfo[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  applyStatus: (next: AgentStatus) => void;
  configure: (input: AgentConfigureInput) => Promise<void>;
}

export const useAppStore = create<AgentConfigState>()((set, get) => ({
  /** 未配置态（不携带任何伪造的 provider/model 值）。 */
  status: { configured: false },
  models: [],
  skills: [],
  workspaces: [],

  refresh: async () => {
    const r = await mainBridge!.cmd<AgentSnapshot>('agent.status');
    if (r.ok) set({ status: toAgentStatus(r.data) });
  },

  refreshSkills: async () => {
    try {
      const r = await mainBridge!.cmd<SkillInfo[]>('skills.list');
      set({ skills: r.ok ? r.data : [] });
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
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
    void get().refreshSkills();
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
    await get().refreshSkills();
    await get().refreshWorkspaces();
  },

  /** 运行配置事件收敛（agent_status_changed）：主进程真相 → 配置域投影。 */
  applyStatus: (next) => {
    set({ status: next });
  },

  /** 增量配置（模型 / 思考档位）：只传变更字段，其余沿用当前 status。 */
  configure: async (input) => {
    const s = get().status;
    const provider = input.provider ?? s.provider;
    const modelId = input.modelId ?? s.modelId;
    if (!provider || !modelId) {
      throw new Error(
        '尚未配置模型：请在「设置 → 模型配置」中登录供应商并选择模型',
      );
    }
    const r = await mainBridge!.cmd<AgentSnapshot>('agent.configure', {
      provider,
      modelId,
      thinkingLevel: input.thinkingLevel ?? s.thinkingLevel,
      ...input,
    });
    if (!r.ok) throw new Error(r.error.message);
    set({ status: toAgentStatus(r.data) });
  },
}));
