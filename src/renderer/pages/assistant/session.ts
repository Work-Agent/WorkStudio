/**
 * 助手视图的数据投影：壳层、Agent、会话与消息流。
 *
 * 主进程是事实源；渲染层只消费 workStudio 状态。
 */
import type {
  AgentSnapshot,
  ModelOption,
  SessionMeta,
} from '../../../shared/types.ts';
import {
  useAppAgent,
  useAppModels,
  useAppSessions,
  useAppShell,
} from './appState.ts';

export interface AssistantShell {
  ui: {
    theme: 'light' | 'dark';
    aiFloating: boolean;
    inputExpanded: boolean;
    activePath: string | null;
    openPaths: string[];
    selectedSkills: string[];
  };
}

export function useShell(): AssistantShell | null {
  return useAppShell();
}

export function useAgent(): AgentSnapshot | null {
  return useAppAgent();
}

export function useSessions(_openPaths: string[]): SessionMeta[] {
  return useAppSessions() ?? [];
}

/** 可选模型（订阅状态路径：设置页增删模型后面板立即跟随）。 */
export function useModels(): ModelOption[] {
  return useAppModels() ?? [];
}
