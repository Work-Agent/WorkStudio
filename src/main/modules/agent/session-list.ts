/** 会话列表投影（不持有 AgentHost 状态）。 */
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { SessionMeta } from '../../../shared/types.ts';
import { readSessionMeta } from './session-index.ts';

export async function listSessions(
  workspacePath: string,
  sessionsDir: string,
): Promise<SessionMeta[]> {
  const infos = await SessionManager.list(workspacePath, sessionsDir);
  return infos
    .map((info) => {
      const meta = readSessionMeta(info.path);
      return {
        path: info.path,
        name:
          info.name ??
          (meta.name ||
            (info.firstMessage
              ? `${info.firstMessage.slice(0, 30)}…`
              : '未命名会话')),
        createdAt: info.created.getTime(),
        preview: meta.preview || info.firstMessage,
        ...(meta.tokens ? { tokens: meta.tokens } : {}),
        messageCount: info.messageCount,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
