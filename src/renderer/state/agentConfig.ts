/**
 * 配置域 store（zustand）—— Agent 运行配置的渲染层投影。
 *
 * 真相源在主进程（默认 provider/model 解析；目录 = models.json）：status 快照经
 * IPC 拉取，configure 增量提交即时生效（S4 模型/思考切换器与模型配置页同源）。
 *
 * 铁律：渲染层不伪造默认值——初始形态 = 「未配置」，真实状态由 init() 首拉注入。
 */
import { create } from 'zustand';
import type {
  AgentConfigureInput,
  AgentStatus,
  ModelOption,
  SkillInfo,
} from '../../shared/types';
import { agentAPI } from '../api/bridge';
import { useDocumentsStore } from './documents';

interface AgentConfigState {
  status: AgentStatus;
  models: ModelOption[];
  skills: SkillInfo[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  applyStatus: (next: AgentStatus) => void;
  configure: (input: AgentConfigureInput) => Promise<void>;
}

export const useAgentConfigStore = create<AgentConfigState>()((set, get) => ({
  /** 未配置态（不携带任何伪造的 provider/model 值）。 */
  status: { configured: false },
  models: [],
  skills: [],

  refresh: async () => {
    set({ status: await agentAPI.status() });
  },

  refreshSkills: async () => {
    try {
      set({ skills: await agentAPI.skills.list() });
    } catch (e) {
      console.error('Failed to load skills:', e);
    }
  },

  init: async () => {
    const [modelOptions] = await Promise.all([
      agentAPI.models(),
      get().refresh(),
      get().refreshSkills(),
    ]);
    set({ models: modelOptions });
    // 投影失效：窗口重新聚焦时重拉快照，保证镜像收敛
    window.addEventListener('focus', () => {
      void get().refresh();
    });
  },

  /** 工作区切换（独立通道，不经模型配置）：重绑资源域/会话域/技能。 */
  switchWorkspace: async (path) => {
    set({ status: await agentAPI.setWorkspace(path) });
    await useDocumentsStore.getState().refresh();
    await get().refreshSkills();
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
      throw new Error('model not configured: pick a model in 模型设置 first');
    }
    const next = await agentAPI.configure({
      provider,
      modelId,
      thinkingLevel: input.thinkingLevel ?? s.thinkingLevel,
      ...input,
    });
    set({ status: next });
  },
}));
