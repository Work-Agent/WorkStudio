/** 助手旧命令 → 新架构路径（仅 app 主进程使用）。 */
import type { AgentSnapshot } from '../../shared/types';
import type { CommandResponse } from '../../shared/types';
import type { WorkspaceMeta } from '../../shared/app';

const bridge = typeof window !== 'undefined' ? window.appBridge : undefined;

async function call<T>(
  path: string,
  input?: unknown,
): Promise<CommandResponse<T>> {
  if (!bridge) {
    return {
      ok: false,
      error: { code: 'failed', message: 'app bridge unavailable' },
    };
  }
  return bridge.call<T>(path, input);
}

async function currentWorkspace(): Promise<string | null> {
  const workspace = await bridge?.peek<WorkspaceMeta>('/workspaces/current');
  return workspace?.id ?? null;
}

async function currentSession(wsId: string): Promise<string | null> {
  const snapshot = await bridge?.peek<AgentSnapshot>(
    `/workspaces/${wsId}/sessions/current`,
  );
  return snapshot?.sessionFile
    ? encodeURIComponent(snapshot.sessionFile)
    : null;
}

export async function appAssistantCommand<T = unknown>(
  command: string,
  params?: unknown,
): Promise<CommandResponse<T>> {
  const input = (params ?? {}) as Record<string, unknown>;
  const wsId = await currentWorkspace();
  if (!wsId) {
    return { ok: false, error: { code: 'unknown', message: 'no workspace' } };
  }
  const session = async (): Promise<string | null> => currentSession(wsId);
  const base = (id: string) => `/workspaces/${wsId}/sessions/${id}`;

  switch (command) {
    case 'session.new':
      return call(`/workspaces/${wsId}/sessions/new`);
    case 'session.getCommands':
      return call(`/workspaces/${wsId}/sessions/commands`);
    case 'session.getMessages': {
      const path = String(input['path'] ?? '');
      if (!path) return { ok: true, data: [] as T };
      return {
        ok: true,
        data: ((await bridge?.peek(
          `${base(encodeURIComponent(path))}/messages`,
        )) ?? []) as T,
      };
    }
    case 'session.openTab':
      return call(`/workspaces/${wsId}/sessions/current/open`, {
        sessionId: encodeURIComponent(String(input['path'] ?? '')),
      });
    case 'session.closeTabs':
      return { ok: true, data: null as T };
    case 'session.prompt':
    case 'session.steer':
    case 'session.followUp':
    case 'session.follow-up':
    case 'session.abort':
    case 'session.compact':
    case 'session.fork':
    case 'session.rename':
    case 'session.delete': {
      const id = await session();
      if (!id) {
        return { ok: false, error: { code: 'unknown', message: 'no session' } };
      }
      const action = command
        .slice('session.'.length)
        .replace('followUp', 'follow-up');
      return call(`${base(id)}/${action}`, input);
    }
    case 'agent.setModel':
      return call(`/workspaces/${wsId}/sessions/model/set`, input);
    case 'agent.setThinking':
      return call(`/workspaces/${wsId}/sessions/thinking/set`, input);
    case 'agent.thinkingLevels':
      return { ok: true, data: ['off', 'low', 'medium', 'high'] as T };
    case 'agent.models':
      return {
        ok: true,
        data: ((await bridge?.peek(`/workspaces/${wsId}/sessions/models`)) ??
          []) as T,
      };
    case 'agent.status': {
      const snapshot = await bridge?.peek<AgentSnapshot>(
        `/workspaces/${wsId}/sessions/current`,
      );
      return { ok: true, data: snapshot as T };
    }
    case 'skills.list': {
      const piconf = await bridge?.peek<{
        skills?: Array<{ name: string; description: string }>;
      }>('/piconf');
      return { ok: true, data: (piconf?.skills ?? []) as T };
    }
    case 'skills.setActive':
      return call('/piconf/skills/set-active', input);
    case 'ui.set':
      return call(`/scene/${wsId}/patch`, {
        ...(typeof input['patch'] === 'object' ? input['patch'] : {}),
      });
    default:
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: `app assistant command not mapped: ${command}`,
        },
      };
  }
}
