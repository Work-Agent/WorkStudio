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
    active: string | null;
  };
  if (!state?.active) throw new Error('workspace is not ready');
  return state.active;
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
      return command('agent', sessionsResource(), 'new');
    case 'session.getCommands': {
      const state = (await next.subscribe('agent', sessionsResource())) as {
        commands?: unknown[];
      } | null;
      return ok(state?.commands ?? []);
    }
    case 'session.getMessages': {
      const state = (await next.subscribe('agent', sessionsResource())) as {
        active?: unknown;
      } | null;
      return ok(state?.active ?? null);
    }
    case 'session.openTab': {
      const path = String(input['path'] ?? '');
      return command('agent', sessionsResource(), 'open', { id: path });
    }
    case 'session.closeTabs':
      return command('agent', sessionsResource(), 'closeOpened', {
        paths: Array.isArray(input['paths']) ? input['paths'] : [],
      });
    case 'session.prompt':
      return command('agent', sessionsResource(), 'prompt', input);
    case 'session.steer':
      return command('agent', sessionsResource(), 'steer', input);
    case 'session.followUp':
    case 'session.follow-up':
      return command('agent', sessionsResource(), 'followUp', input);
    case 'session.abort':
      return command('agent', sessionsResource(), 'abort');
    case 'session.retry':
      return command('agent', sessionsResource(), 'retry', input);
    case 'session.compact':
      return command('agent', sessionsResource(), 'compact', input);
    case 'session.fork':
      return command('agent', sessionsResource(), 'fork', input);
    case 'session.rename':
      return command('agent', sessionsResource(), 'rename', input);
    case 'session.delete':
      return command('agent', sessionsResource(), 'delete', input);
    case 'agent.setModel':
      return command('agent', sessionsResource(), 'setModel', input);
    case 'agent.setThinking':
      return command('agent', sessionsResource(), 'setThinking', input);
    case 'agent.thinkingLevels': {
      const state = (await next.subscribe('agent', sessionsResource())) as {
        thinking?: { levels?: string[] };
      } | null;
      return ok(state?.thinking?.levels ?? []);
    }
    case 'agent.status':
      return ok(
        (
          (await next.subscribe('agent', sessionsResource())) as {
            current?: unknown;
          }
        )?.current ?? null,
      );
    case 'skills.list': {
      const state = (await next.subscribe('agent', 'skills')) as {
        catalog?: unknown[];
      } | null;
      return ok(state?.catalog ?? []);
    }
    case 'skills.setActive':
      return command('agent', 'skills', 'setActive', {
        names: Array.isArray(input['names']) ? input['names'] : [],
      });
    case 'ui.set': {
      const patch = (input['patch'] ?? {}) as Record<string, unknown>;
      const wsId = await workspaceId();
      if (typeof patch['theme'] === 'string') {
        await command('shell', 'appearance', 'set', {
          source: patch['theme'],
        });
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
        await command('shell', `${wsId}/layout`, 'scene', {
          patch: scene,
        });
      }
      return ok(null);
    }
    default:
      return fail(`assistant command not mapped: ${name}`);
  }
}

/** 会话投影按窗口工作区寻址：`agent/<wsId>/sessions`。 */
function sessionsResource(): string {
  const ws = window.workStudio?.workspaceId;
  return ws ? `${ws}/sessions` : 'sessions';
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
          const result = await command('shell', `${wsId}/layout`, 'begin', {
            input: lastInput,
          });
          return { ok: result.ok };
        },
        async move(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command('shell', `${wsId}/layout`, 'move', {
            input: lastInput,
          });
          return { ok: result.ok };
        },
        async end(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command('shell', `${wsId}/layout`, 'end', {});
          return { ok: result.ok };
        },
        async cancel(): Promise<{ ok: boolean }> {
          const wsId = await workspaceId();
          const result = await command('shell', `${wsId}/layout`, 'cancel', {});
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
