import type { AgentSnapshot, ModelOption } from '../../../shared/types';
import type { RouteCall } from '../../core/types';
import {
  isSessionStreamEvent,
  type SessionListItem,
  type SessionStreamEvent,
  type SessionStreamState,
  type SessionsService,
} from '../../service/sessions';
import type { Router } from '../router';
import { idOf, wsIdOf, type WorkspaceRef } from './shared';

// ─── sessions ───────────────────────────────────────────

export function routesSessions(r: Router, service: SessionsService): void {
  const list = r.state<SessionListItem[]>('/');
  const current = r.state<AgentSnapshot>('/current');
  const models = r.state<ModelOption[]>('/models');
  const session = r.state<SessionListItem>('/:sessionId');
  const messages = r.state('/:sessionId/messages');
  const stream = r.state<SessionStreamState>('/:sessionId/stream');
  const delta = r.event<SessionStreamEvent>('/:sessionId/stream/delta', {
    view: true,
    validate: isSessionStreamEvent,
  });

  const publish = (): void => {
    const wsId = wsIdOf(r);
    if (!wsId) return;
    list.publish({ wsId }, service.list);
    if (service.current) current.publish({ wsId }, service.current);
    models.publish({ wsId }, service.models());
    for (const item of service.list) {
      session.publish({ wsId, sessionId: item.id }, item);
      messages.publish({ wsId, sessionId: item.id }, service.messages(item.id));
    }
    if (service.current?.sessionFile) {
      const sessionId = idOf(service.current.sessionFile);
      // 新会话在列表刷新前也要发布历史，否则首轮消息只能等整轮结束才回显。
      messages.publish({ wsId, sessionId }, service.messages(sessionId));
      stream.publish({ wsId, sessionId }, service.stream(sessionId));
    }
  };
  service.onChange(publish);
  r.on<WorkspaceRef | null>('/workspaces/current', () => publish());
  r.on<{ id: string }>('/workspaces/closed', (value) => {
    list.drop({ wsId: value.id });
    current.drop({ wsId: value.id });
    for (const item of service.list) {
      session.drop({ wsId: value.id, sessionId: item.id });
      messages.drop({ wsId: value.id, sessionId: item.id });
      stream.drop({ wsId: value.id, sessionId: item.id });
    }
  });
  service.onStream((sessionId, state) => {
    const wsId = r.get<WorkspaceRef>('/workspaces/current')?.id;
    if (!wsId) return;
    stream.publish({ wsId, sessionId }, state);
  });
  service.onStreamEvent((sessionId, event) => {
    const wsId = r.get<WorkspaceRef>('/workspaces/current')?.id;
    if (!wsId) return;
    delta.emit({ wsId, sessionId }, event);
  });
  publish();

  r.handle('/new', async () => {
    await service.newSession();
    return { ok: true };
  });
  r.handle('/current/open', async (call: RouteCall<{ sessionId: string }>) => {
    await service.openSession(call.input.sessionId);
    return { ok: true };
  });
  r.handle(
    '/:sessionId/prompt',
    async (
      call: RouteCall<{
        text: string;
        newSession?: boolean;
        activeSkills?: string[];
      }>,
    ) => {
      await service.prompt(call.input);
      return { ok: true };
    },
  );
  r.handle('/:sessionId/steer', async (call: RouteCall<{ text: string }>) => {
    await service.steer(call.input.text);
    return { ok: true };
  });
  r.handle(
    '/:sessionId/follow-up',
    async (call: RouteCall<{ text: string }>) => {
      await service.followUp(call.input.text);
      return { ok: true };
    },
  );
  r.handle('/:sessionId/abort', async () => {
    await service.abort();
    return { ok: true };
  });
  r.handle(
    '/:sessionId/compact',
    async (call: RouteCall<{ instructions?: string }>) => {
      await service.compact(call.input.instructions);
      return { ok: true };
    },
  );
  r.handle(
    '/:sessionId/fork',
    (call: RouteCall<{ entryId: string; position?: 'before' | 'at' }>) =>
      service.fork(call.input.entryId, call.input.position),
  );
  r.handle('/:sessionId/rename', (call: RouteCall<{ name: string }>) => {
    service.rename(String(call.params['sessionId']), call.input.name);
    return { ok: true };
  });
  r.handle('/:sessionId/delete', async (call: RouteCall<null>) => {
    const sessionId = String(call.params['sessionId']);
    const wsId = wsIdOf(r);
    await service.deleteSession(sessionId);
    if (wsId) {
      session.drop({ wsId, sessionId });
      messages.drop({ wsId, sessionId });
      stream.drop({ wsId, sessionId });
    }
    return { ok: true };
  });
  r.handle('/commands', () => service.commands());
  r.handle('/list/refresh', async () => {
    await service.refresh();
    return { ok: true };
  });
  r.handle(
    '/model/set',
    async (call: RouteCall<{ provider: string; modelId: string }>) => {
      await service.setModel(call.input.provider, call.input.modelId);
      return { ok: true };
    },
  );
  r.handle('/thinking/set', (call: RouteCall<{ level: string }>) => {
    service.setThinking(call.input.level);
    return { ok: true };
  });
  r.handle(
    '/steering/set',
    (call: RouteCall<{ mode: 'all' | 'one-at-a-time' }>) => {
      service.setSteeringMode(call.input.mode);
      return { ok: true };
    },
  );
  r.handle(
    '/follow-up-mode/set',
    (call: RouteCall<{ mode: 'all' | 'one-at-a-time' }>) => {
      service.setFollowUpMode(call.input.mode);
      return { ok: true };
    },
  );
  r.handle('/auto-compaction/set', (call: RouteCall<{ enabled: boolean }>) => {
    service.setAutoCompaction(call.input.enabled);
    return { ok: true };
  });
  r.on<{ area: string }>('/piconf/changed', () => service.reloadResources());
}
