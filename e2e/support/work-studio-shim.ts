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
    const state = (await next.subscribe('shell', 'windows')) as {
      active?: string | null;
    };
    if (!state.active) throw new Error('workspace is not ready');
    return state.active;
  };
  const call = async (path: string, input?: unknown) => {
    const value = (input ?? {}) as Record<string, unknown>;
    if (path === '/workspaces/current') {
      const registry = (await next.subscribe('workspace', 'registry')) as {
        current?: unknown;
      };
      return { ok: true as const, data: registry.current ?? null };
    }
    if (path === '/workspaces') {
      const registry = (await next.subscribe('workspace', 'registry')) as {
        workspaces?: unknown[];
      };
      return { ok: true as const, data: registry.workspaces ?? [] };
    }
    if (path === '/views') {
      return {
        ok: true as const,
        data: await next.subscribe('shell', 'views'),
      };
    }
    if (path === '/dialogs')
      return {
        ok: true as const,
        data: await next.subscribe('shell', 'dialogs'),
      };
    if (path === '/settings/open')
      return next.command('settings', 'pages', 'open', {
        pageId: value['pageId'],
      });
    if (path === '/workspaces/open')
      return next.command('workspace', 'registry', 'open', value);
    if (path === '/plugins/open')
      return next.command('plugin', 'installed', 'open', {
        id: value['pluginId'],
      });
    if (path === '/dialogs/open') {
      const request = (value['request'] ?? value) as Record<string, unknown>;
      return next.command('shell', 'dialogs', 'open', request);
    }
    const site = /^\/workspaces\/[^/]+\/sites\/web\/open$/.exec(path);
    if (site) {
      const result = await next.command('browser', 'tabs', 'open', value);
      return result.ok
        ? {
            ok: true as const,
            data: { viewId: (result.data as { id: string }).id },
          }
        : result;
    }
    const resource = /^\/workspaces\/[^/]+\/resources\/pages\/open$/.exec(path);
    if (resource) {
      const result = await next.command('shell', 'views', 'open', {
        id: String(value['ref'] ?? ''),
        type: 'page',
        title: String(value['ref'] ?? ''),
        url: String(value['ref'] ?? ''),
      });
      return result.ok
        ? {
            ok: true as const,
            data: { viewId: (result.data as { id: string }).id },
          }
        : result;
    }
    const view = /^\/views\/(.+)\/(close|activate)$/.exec(path);
    if (view) {
      const id = decodeURIComponent(view[1]!);
      if (view[2] === 'close')
        return next.command('shell', 'views', 'close', { id });
      if (view[2] === 'activate')
        return next.command('shell', 'views', 'activate', { id });
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
