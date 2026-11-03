/**
 * 助手视图的数据投影：壳层、Agent、会话与消息流。
 *
 * 主进程是事实源；渲染层只消费 appBridge 状态。
 */
import type { AgentSnapshot, SessionMeta } from '../../shared/types';
import { useAppAgent, useAppSessions, useAppShell } from './appState';

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
