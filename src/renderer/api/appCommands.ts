/**
 * 壳层命令适配：组件保留语义命令名，统一映射到 appBridge 路径。
 */
import { fileRef } from '../../shared/ura';
import type { CommandResponse } from '../../shared/types';

const appBridge = typeof window !== 'undefined' ? window.appBridge : undefined;

let currentWsId: string | null = null;
let currentWsPath: string | null = null;

export function setCurrentWorkspaceId(id: string | null): void {
  currentWsId = id;
}

export function currentWorkspaceId(): string | null {
  return currentWsId;
}

export function setCurrentWorkspacePath(path: string | null): void {
  currentWsPath = path;
}

async function call<T>(
  path: string,
  input?: unknown,
): Promise<CommandResponse<T>> {
  if (!appBridge) {
    return {
      ok: false,
      error: { code: 'failed', message: 'app bridge unavailable' },
    };
  }
  const result = await appBridge.call<T>(path, input);
  return result;
}

function inputOf(params: unknown): Record<string, unknown> {
  const value = params as { input?: unknown } | undefined;
  return (value?.input ?? params ?? {}) as Record<string, unknown>;
}

function workspaceId(): string {
  if (!currentWsId) throw new Error('current workspace is not ready');
  return currentWsId;
}

async function appCommand<T>(
  command: string,
  params?: unknown,
): Promise<CommandResponse<T>> {
  const input = inputOf(params);
  switch (command) {
    case 'views.open': {
      const type = String(input['type'] ?? '');
      if (type === 'settings') {
        return call('/settings/open', {
          pageId: String(input['pageId'] ?? ''),
        });
      }
      if (type === 'plugin') {
        return call('/plugins/open', {
          pluginId: String(input['pluginId'] ?? ''),
          // 插件出口必须显式：page = 文档查看器，settings = 配置面。
          surface: input['surface'] === 'page' ? 'page' : 'settings',
        });
      }
      if (type === 'browser') {
        const result = await call<{ viewId: string }>(
          `/workspaces/${workspaceId()}/sites/web/open`,
          { url: String(input['url'] ?? '') },
        );
        return result.ok
          ? { ok: true, data: { id: result.data.viewId } as T }
          : result;
      }
      return call('/views/open', { path: String(input['path'] ?? '') });
    }
    case 'views.activate':
    case 'views.close':
    case 'views.reload':
    case 'views.togglePin':
    case 'views.move':
    case 'views.closeOthers':
    case 'views.closeToLeft':
    case 'views.closeToRight':
    case 'views.goBack':
    case 'views.goForward': {
      const id = String(
        input['id'] ?? input['viewId'] ?? input['fromId'] ?? '',
      );
      const action = command.slice('views.'.length);
      const path =
        action === 'togglePin'
          ? `/views/${id}/toggle-pin`
          : action === 'closeOthers'
            ? `/views/${id}/close-others`
            : action === 'closeToLeft'
              ? `/views/${id}/close-to-left`
              : action === 'closeToRight'
                ? `/views/${id}/close-to-right`
                : action === 'goBack'
                  ? `/views/${id}/go-back`
                  : action === 'goForward'
                    ? `/views/${id}/go-forward`
                    : `/views/${id}/${action}`;
      return call(
        path,
        action === 'move' ? { toId: input['toId'] } : undefined,
      );
    }
    case 'views.closeAll':
      return call('/views/close-all');
    case 'views.runAction':
    case 'views.action': {
      const id = String(
        input['id'] ?? input['viewId'] ?? input['fromId'] ?? '',
      );
      const action = input['action'] ?? input['actionId'] ?? '';
      return call(
        `/views/${id}/${command === 'views.runAction' ? 'run-action' : 'action'}`,
        { action: String(action) },
      );
    }
    case 'views.navigate':
      return call(`/views/${String(input['id'] ?? '')}/navigate`, {
        url: String(input['url'] ?? ''),
      });
    case 'views.openResource':
      return call(`/workspaces/${workspaceId()}/resources/pages/open`, {
        ref: String(input['ref'] ?? ''),
      });
    case 'ui.set': {
      const patch = (params as { patch?: Record<string, unknown> } | undefined)
        ?.patch;
      if (!patch) return { ok: true, data: null as T };
      const native: Record<string, unknown> = {};
      for (const key of [
        'paneWidths',
        'sidebarCollapsed',
        'aiOpen',
        'aiFloating',
        'floating',
      ]) {
        if (key in patch) native[key] = patch[key];
      }
      const theme = patch['theme'];
      if (typeof theme === 'string') {
        await call('/theme/set', { theme });
      }
      if (Object.keys(native).length === 0) {
        return { ok: true, data: null as T };
      }
      return call(`/scene/${workspaceId()}/patch`, native);
    }
    case 'agent.setWorkspace':
      return call('/workspaces/open', { path: String(input['path'] ?? '') });
    case 'agent.pickWorkspace':
      return call('/native/pick-directory');
    case 'debug.viewport':
      return call('/viewport/set', {
        width: Number(input['width'] ?? 0),
        height: Number(input['height'] ?? 0),
      });
    case 'list.action':
      return call(`/workspaces/${workspaceId()}/lists/action`, input);
    case 'ura.workspace':
      return currentWsPath
        ? { ok: true, data: { root: currentWsPath } as T }
        : { ok: false, error: { code: 'unknown', message: 'no workspace' } };
    case 'ura.find':
      return call(`/workspaces/${workspaceId()}/resources/find`, {
        pattern: String(input['pattern'] ?? ''),
        options: {
          ...(currentWsPath ? { scope: fileRef(currentWsPath) } : {}),
          ...(input['limit'] ? { limit: input['limit'] } : {}),
        },
      });
    default:
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: `app command not mapped: ${command}`,
        },
      };
  }
}

export function cmd<T = unknown>(
  command: string,
  params?: unknown,
): Promise<CommandResponse<T>> {
  return appCommand<T>(command, params);
}
