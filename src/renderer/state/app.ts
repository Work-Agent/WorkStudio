/**
 * App 作用域 store（zustand）—— 应用级模型目录、工作区目录与运行状态投影。
 *
 * 真相源在主进程：状态经 appBridge 投影，工作区切换走 agent.setWorkspace。
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

import { cmd } from '../api/appCommands';

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
  switchWorkspace: (path: string) => Promise<void>;
}

export const useAppStore = create<AppState>()((set) => ({
  /** 未配置态（不携带任何伪造的 provider/model 值）。 */
  status: { configured: false },
  models: [],
  workspaces: [],

  /** 工作区切换（独立通道，不经模型配置）：重绑资源域/会话域/技能。 */
  switchWorkspace: async (path) => {
    const r = await cmd<AgentSnapshot>('agent.setWorkspace', {
      path,
    });
    if (!r.ok) throw new Error(r.error.message);
    set({ status: toAgentStatus(r.data) });
  },
}));
