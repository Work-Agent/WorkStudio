/**
 * 助手视图的 workStudio 门面。
 *
 * 命令与状态都走 next domain；不再依赖旧路径兼容层。
 */
import type { CommandResponse } from '../../../shared/types.ts';

const next = typeof window !== 'undefined' ? window.workStudio : undefined;

let lastInput: Record<string, unknown> | null = null;

const ok = <T>(data: T): CommandResponse<T> => ({ ok: true, data });
const fail = (message: string): CommandResponse<never> => ({
  ok: false,
  error: { code: 'failed', message },
});

async function workspaceId(): Promise<string> {
  if (!next) throw new Error('workStudio unavailable');
  const state = (await next.subscribe('shell', 'windows')) as {
    activeWsId: string | null;
  };
  if (!state?.activeWsId) throw new Error('workspace is not ready');
  return state.activeWsId;
}

async function command<T>(
  domain: string,
  resource: string,
  action: string,
  input?: unknown,
): Promise<CommandResponse<T>> {
  if (!next) return fail('workStudio unavailable');
  const result = await next.command<T>(domain, resource, action, input);
  return result.ok
    ? ok(result.data)
    : {
        ok: false,
        error: { code: result.error.code, message: result.error.message },
      };
}

async function assistantCommand(
  name: string,
  params?: unknown,
): Promise<CommandResponse<unknown>> {
  if (!next) return fail('workStudio unavailable');
  const input = (params ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'session.new':
      return command('sessions', 'current', 'new');
    case 'session.getCommands':
      return ok((await next.subscribe('sessions', 'commands')) ?? []);
    case 'session.getMessages':
      return ok((await next.subscribe('sessions', 'active')) as never);
    case 'session.openTab': {
      const path = String(input['path'] ?? '');
      return command('sessions', 'current', 'open', {
        sessionId: encodeURIComponent(path),
      });
    }
    case 'session.closeTabs':
      return command('sessions', 'opened', 'close', {
        paths: Array.isArray(input['paths']) ? input['paths'] : [],
      });
    case 'session.prompt':
      return command('sessions', 'current', 'prompt', input);
    case 'session.steer':
      return command('sessions', 'current', 'steer', input);
    case 'session.followUp':
    case 'session.follow-up':
      return command('sessions', 'current', 'followUp', input);
    case 'session.abort':
      return command('sessions', 'current', 'abort');
    case 'session.retry':
      return command('sessions', 'current', 'retry', input);
    case 'session.compact':
      return command('sessions', 'current', 'compact', input);
    case 'session.fork':
      return command('sessions', 'current', 'fork', input);
    case 'session.rename':
      return command('sessions', 'current', 'rename', input);
    case 'session.delete':
      return command('sessions', 'current', 'delete', input);
    case 'agent.setModel':
      return command('sessions', 'current', 'setModel', input);
    case 'agent.setThinking':
      return command('thinking', 'current', 'set', input);
    case 'agent.thinkingLevels': {
      const state = (await next.subscribe('thinking', 'current')) as {
        levels?: string[];
      } | null;
      return ok(state?.levels ?? []);
    }
    case 'agent.status':
      return ok((await next.subscribe('sessions', 'current')) ?? null);
    case 'skills.list':
      return ok((await next.subscribe('skills', 'catalog')) ?? []);
    case 'skills.setActive':
      return command('skills', 'active', 'setActive', {
        names: Array.isArray(input['names']) ? input['names'] : [],
      });
    case 'ui.set': {
      const patch = (input['patch'] ?? {}) as Record<string, unknown>;
      const wsId = await workspaceId();
      if (typeof patch['theme'] === 'string') {
        await command('shell', 'theme', 'set', patch['theme']);
      }
      const scene: Record<string, unknown> = {};
      for (const key of [
        'paneWidths',
        'sidebarCollapsed',
        'aiOpen',
        'aiFloating',
        'floating',
      ]) {
        if (key in patch) scene[key] = patch[key];
      }
      if (Object.keys(scene).length > 0) {
        await command('shell', `scene:${wsId}`, 'patch', scene);
      }
      return ok(null);
    }
    default:
      return fail(`assistant command not mapped: ${name}`);
  }
}

export const bridge = next
  ? {
      cmd: <T = unknown>(name: string, params?: unknown) =>
        assistantCommand(name, params) as Promise<CommandResponse<T>>,
      interaction: {
        async begin(input: {
          type: string;
          target?: string;
          direction?: string;
          anchor?: { x: number; y: number };
        }): Promise<{ ok: boolean }> {
          lastInput = {
            type: input.type,
            ...(input.target ? { target: input.target } : {}),
            ...(input.direction ? { direction: input.direction } : {}),
            pointerX: input.anchor?.x ?? 0,
            pointerY: input.anchor?.y ?? 0,
          };
          const wsId = await workspaceId();
          const result = await command(
            'shell',
            `layout:${wsId}`,
            'begin',
            lastInput,
          );
          return { ok: result.ok };
        },
        async move(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command(
            'shell',
            `layout:${wsId}`,
            'move',
            lastInput,
          );
          return { ok: result.ok };
        },
        async end(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command('shell', `layout:${wsId}`, 'end');
          return { ok: result.ok };
        },
        async cancel(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command('shell', `layout:${wsId}`, 'cancel');
          return { ok: result.ok };
        },
      },
      async popupMenu(input: {
        items: Array<{ id: string; label: string; disabled?: boolean }>;
      }): Promise<string | null> {
        const result = await command<string | null>(
          'shell',
          'native',
          'popupMenu',
          {
            items: input.items,
          },
        );
        return result.ok ? result.data : null;
      },
    }
  : undefined;

export const MENU_SOURCE = 'chat-tabs';
