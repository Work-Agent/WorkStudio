import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { DomainRegistry } from '../../runtime/domains.ts';
import type { ResourcesService } from './resources/service.ts';
import type { UraRuntime } from './ura/index.ts';

export interface ResourcesRuntime {
  service: ResourcesService;
  ura: UraRuntime;
}

export interface ResourcesDeps {
  current(): WorkspaceMeta | null;
  runtime(): ResourcesRuntime | null;
  ensure(): Promise<ResourcesRuntime>;
  changed(): void;
  openView(ref: string): Promise<{ id: string }>;
  openWeb(url: string, title?: string): Promise<{ id: string }>;
  openPageView(ref: string): Promise<{
    type: 'page' | 'browser';
    pageId?: string;
    viewId?: string;
    url?: string;
  }>;
  saveCopy(
    pageId: string,
    content: string | Uint8Array,
  ): Promise<{ saved: boolean; ref?: string }>;
  refresh(): Promise<void>;
}

/** resources/<scope>：当前工作区的资源会话与 URA 能力。 */
export function defineResourcesDomain(
  registry: DomainRegistry,
  deps: ResourcesDeps,
  resourceName = 'current',
  scopeId?: string,
): void {
  const resource = registry.define('resources').resource(resourceName);
  const withRuntime = async <T>(
    handler: (runtime: ResourcesRuntime) => T | Promise<T>,
  ): Promise<T> => handler(await deps.ensure());

  resource.snapshot(() => {
    const runtime = deps.runtime();
    return {
      workspaceId: scopeId ?? deps.current()?.id ?? null,
      ready: Boolean(runtime),
      pages: runtime?.service.pages() ?? [],
    };
  });

  resource.command<{ ref: string; options?: never }, unknown>('read', (call) =>
    withRuntime((rt) => rt.service.read(call.input.ref, call.input.options)),
  );
  resource.command<
    { ref: string; content: string | Uint8Array },
    { version: string }
  >('write', (call) =>
    withRuntime((rt) => rt.service.write(call.input.ref, call.input.content)),
  );
  resource.command<
    {
      ref: string;
      anchor: { start: number; end: number; expected?: string };
      content: string | Uint8Array;
    },
    { version: string }
  >('edit', (call) =>
    withRuntime((rt) =>
      rt.service.edit(call.input.ref, call.input.anchor, call.input.content),
    ),
  );
  resource.command<{ ref: string }, unknown>('ls', (call) =>
    withRuntime((rt) => rt.service.ls(call.input.ref)),
  );
  resource.command<{ pattern: string; options?: never }, unknown>(
    'find',
    (call) =>
      withRuntime((rt) =>
        rt.service.find(call.input.pattern, call.input.options),
      ),
  );
  resource.command<{ pattern: string; options?: never }, unknown>(
    'grep',
    (call) =>
      withRuntime((rt) =>
        rt.service.grep(call.input.pattern, call.input.options),
      ),
  );
  resource.command<{ ref: string; query: unknown }, unknown>('query', (call) =>
    withRuntime((rt) =>
      rt.service.query(call.input.ref, call.input.query as never),
    ),
  );
  resource.command<{ pageId: string }, unknown>('getPage', (call) =>
    withRuntime((rt) => rt.service.page(call.input.pageId) ?? null),
  );
  resource.command<{ ref: string; limit?: number }, unknown>('tree', (call) =>
    withRuntime((rt) => rt.service.tree(call.input.ref, call.input.limit)),
  );
  resource.command<{ ref: string }, { ref: string }>('watch', (call) =>
    withRuntime((rt) => {
      rt.service.watch(call.input.ref);
      return { ref: call.input.ref };
    }),
  );
  resource.command<{ ref: string }, null>('unwatch', (call) =>
    withRuntime((rt) => {
      rt.service.unwatch(call.input.ref);
      return null;
    }),
  );
  resource.command<{ ref: string }, { id: string }>('open', (call) =>
    deps.openView(String(call.input.ref)),
  );
  resource.command<{ ref: string }, unknown>('openPageView', (call) =>
    deps.openPageView(String(call.input.ref)),
  );
  resource.command<null, null>('refresh', async () => {
    await deps.refresh();
    return null;
  });
  resource.command<{ url: string; title?: string }, { id: string }>(
    'openWeb',
    (call) => deps.openWeb(String(call.input.url), call.input.title),
  );
  resource.command<{ ref: string }, unknown>('openPage', async (call) => {
    const result = await withRuntime((rt) =>
      rt.service.openPage(call.input.ref),
    );
    deps.changed();
    return result;
  });
  resource.command<
    { pageId: string; content: string | Uint8Array },
    { version: string }
  >('savePage', async (call) => {
    const result = await withRuntime((rt) =>
      rt.service.savePage(call.input.pageId, call.input.content),
    );
    deps.changed();
    return result;
  });
  resource.command<{ pageId: string; external?: boolean }, unknown>(
    'reloadPage',
    async (call) => {
      const result = await withRuntime((rt) =>
        rt.service.reloadPage(call.input.pageId, call.input.external),
      );
      deps.changed();
      return result;
    },
  );
  resource.command<{ pageId: string }, null>('closePage', (call) => {
    withRuntime((rt) => {
      rt.service.closePage(call.input.pageId);
      return null;
    });
    deps.changed();
    return null;
  });
}
