/**
 * 助手视图的数据投影：壳层快照、Agent 状态、会话列表与消息流。
 *
 * 主进程是事实源；这里只做 AppSnapshot / AppEvent → React 状态的投影。
 */
import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../../shared/app';
import type { AgentSnapshot, SessionMeta } from '../../shared/types';
import { bridge } from './bridge';

// ─── 事实订阅 ─────────────────────────────────────────────

interface AssistantShell {
  ui: {
    theme: 'light' | 'dark';
    aiFloating: boolean;
    inputExpanded: boolean;
    activePath: string | null;
    openPaths: string[];
    selectedSkills: string[];
  };
}

function shellFrom(snapshot: AppSnapshot): AssistantShell {
  return {
    ui: {
      theme: snapshot.ui.theme,
      aiFloating: snapshot.ui.assistant.floating,
      inputExpanded: snapshot.ui.assistant.inputExpanded,
      activePath: snapshot.session.meta?.path ?? null,
      openPaths: snapshot.ui.openSessionPaths,
      selectedSkills: snapshot.session.context.activeSkills,
    },
  };
}

export function useShell(): AssistantShell | null {
  const [shell, setShell] = useState<AssistantShell | null>(null);
  useEffect(() => {
    if (!bridge) return;
    void bridge.appSync().then((snapshot) => setShell(shellFrom(snapshot)));
    const off = bridge.onAppSnapshot((snapshot) =>
      setShell(shellFrom(snapshot)),
    );
    return off;
  }, []);
  return shell;
}

export function useAgent(): AgentSnapshot | null {
  const [agent, setAgent] = useState<AgentSnapshot | null>(null);
  useEffect(() => {
    const api = bridge;
    if (!api) return;
    void api.appSync().then((snapshot) => setAgent(snapshot.session.snapshot));
    const off = api.onAppEvent((event) => {
      if (event.scope !== 'session') return;
      const ev = event.event as { type: string; status?: AgentSnapshot };
      if (ev.type === 'agent_status_changed' && ev.status) setAgent(ev.status);
      if (ev.type === 'agent_settled') {
        void api
          .cmd<AgentSnapshot>('agent.status')
          .then((r) => r.ok && setAgent(r.data));
      }
    });
    return off;
  }, []);
  return agent;
}

/** 全部会话（标签显示名 + 新会话命名）；事件驱动刷新。 */
export function useSessions(openPaths: string[]): SessionMeta[] {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  useEffect(() => {
    if (!bridge) return;
    void bridge
      .appSync()
      .then((snapshot) => setSessions(snapshot.workspace.sessions));
    const off = bridge.onAppSnapshot((snapshot) =>
      setSessions(snapshot.workspace.sessions),
    );
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPaths.join('|')]);
  return sessions;
}
