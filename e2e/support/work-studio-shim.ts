/**
 * 测试专用 legacy 路径垫片：把仍按路径断言的共享用例翻译成 workStudio。
 *
 * 生产壳层只暴露 workStudio；这里让仍按路径断言/操作的共享用例可以继续运行，
 * 新用例应直接使用 ctx 的 next 命令，不再依赖垫片。
 */
export function installWorkStudioBridgeShim(): void {
  const scope = window as unknown as {
    workStudio?: {
      subscribe(domain: string, resource: string): Promise<unknown>;
      command(
        domain: string,
        resource: string,
        action: string,
        input?: unknown,
      ): Promise<
        { ok: true; data: unknown } | { ok: false; error: { message: string } }
      >;
    };
    __e2eBridge?: unknown;
  };
  const next = scope.workStudio;
  if (!next) return;

  const active = async (): Promise<string> => {
    const state = (await next.subscribe('windows', 'list')) as {
      activeWsId?: string | null;
    };
    if (!state.activeWsId) throw new Error('workspace is not ready');
    return state.activeWsId;
  };
  const call = async (path: string, input?: unknown) => {
    const value = (input ?? {}) as Record<string, unknown>;
    if (path === '/workspaces/current')
      return {
        ok: true as const,
        data: await next.subscribe('workspaces', 'current'),
      };
    if (path === '/workspaces')
      return {
        ok: true as const,
        data: await next.subscribe('workspaces', 'list'),
      };
    if (path === '/views') {
      const tabs = (await next.subscribe('tabs', await active())) as {
        list?: unknown[];
      };
      return { ok: true as const, data: tabs.list ?? [] };
    }
    if (path === '/dialogs')
      return {
        ok: true as const,
        data: await next.subscribe('dialogs', 'list'),
      };
    if (path === '/settings/open')
      return next.command('settings', 'pages', 'open', {
        pageId: value['pageId'],
      });
    if (path === '/workspaces/open')
      return next.command('workspaces', 'list', 'open', value);
    if (path === '/plugins/open')
      return next.command('plugins', 'list', 'open', value);
    if (path === '/dialogs/open')
      return next.command('dialogs', 'list', 'open', value);
    const site = /^\/workspaces\/[^/]+\/sites\/web\/open$/.exec(path);
    if (site) {
      const result = await next.command(
        'resources',
        'current',
        'openWeb',
        value,
      );
      return result.ok
        ? {
            ok: true as const,
            data: { viewId: (result.data as { id: string }).id },
          }
        : result;
    }
    const resource = /^\/workspaces\/[^/]+\/resources\/pages\/open$/.exec(path);
    if (resource) {
      const result = await next.command('resources', 'current', 'open', value);
      return result.ok
        ? {
            ok: true as const,
            data: { viewId: (result.data as { id: string }).id },
          }
        : result;
    }
    const view = /^\/views\/([^/]+)\/([^/]+)$/.exec(path);
    if (view) {
      const wsId = await active();
      const id = decodeURIComponent(view[1]!);
      if (view[2] === 'close') return next.command('tabs', wsId, 'close', id);
      if (view[2] === 'activate')
        return next.command('tabs', wsId, 'activate', id);
    }
    return {
      ok: false as const,
      error: { message: `legacy bridge path not mapped: ${path}` },
    };
  };
  scope.__e2eBridge = {
    available: async () => true,
    call,
    peek: async (path: string) => {
      const result = await call(path);
      return result.ok ? result.data : null;
    },
    watch: async (paths: string[]) => ({ granted: paths, denied: [] }),
    emit: () => undefined,
    on: () => () => undefined,
  };
}
