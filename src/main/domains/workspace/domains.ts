/**
 * workspace 模块持有的 System Domain：workspace · list。
 *
 * WorkspaceScope 是 Workspace 作用域的状态切片与操作；
 * 域只宣告资源与命令，切换 / 释放由模块生命周期驱动。
 */

import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ListItem, ListSnapshot } from '../../../shared/lists.ts';
import { CallFailure } from '../../contract.ts';
import { pending } from '../../registry/command.ts';
import type { TransportRouter } from '../../transport/router.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { WorkspaceRepository } from './repo.ts';

interface OpenedResource {
  ref: string;
  snapshot: unknown;
}

export class WorkspaceScope {
  current: WorkspaceMeta | null = null;

  private readonly known = new Map<string, WorkspaceMeta>();
  private readonly opened = new Map<string, OpenedResource>();
  private registry: DomainRegistry | null = null;
  private offChanged: (() => void) | null = null;

  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly transport?: TransportRouter,
  ) {}

  bind(registry: DomainRegistry): void {
    this.registry = registry;
    this.offChanged = registry.onUpdate((update) => {
      if (update.type !== 'event' || update.event !== 'changed') return;
      if (update.domain !== 'workspace') return;
      if (this.opened.has(update.resource)) {
        void this.refreshRef(update.resource);
      }
    });
  }

  snapshot(): {
    current: WorkspaceMeta | null;
    workspaces: WorkspaceMeta[];
  } {
    return {
      current: this.current,
      workspaces: [...this.known.values()],
    };
  }

  restore(): void {
    for (const meta of this.repo.list()) this.known.set(meta.id, meta);
    const restored = this.repo.restore();
    if (restored) this.activate(restored);
    else this.publish();
  }

  activate(meta: WorkspaceMeta): void {
    if (this.current?.id !== meta.id) this.release();
    this.current = meta;
    this.transport?.setWorkspaceRoot(meta.path);
    this.known.set(meta.id, meta);
    this.repo.writeCurrent(meta.id);
    this.publish();
  }

  open(path: string): WorkspaceMeta {
    const meta = this.repo.register(path);
    this.activate(meta);
    return meta;
  }

  release(): void {
    for (const ref of this.opened.keys()) {
      this.registry?.define('workspace').remove(ref);
    }
    this.opened.clear();
    this.current = null;
    this.publish();
  }

  dispose(): void {
    this.offChanged?.();
    this.offChanged = null;
    this.release();
    this.registry = null;
  }

  close(id: string): void {
    if (this.current?.id === id) {
      this.release();
    } else {
      this.publish();
    }
    this.repo.writeCurrent(this.current?.id ?? null);
  }

  rename(id: string, name: string): WorkspaceMeta | null {
    const meta = this.repo.rename(id, name);
    if (!meta) return null;
    this.known.set(meta.id, meta);
    if (this.current?.id === meta.id) this.current = meta;
    this.publish();
    return meta;
  }

  remove(id: string): void {
    this.repo.remove(id);
    this.known.delete(id);
    if (this.current?.id === id) this.release();
    else this.publish();
  }

  /** `workspace/<ref>`：打开的资源才建立订阅地址。 */
  openRef(ref: string): void {
    const registry = this.registry;
    if (!registry) throw new CallFailure('failed', '注册表未接入');
    if (!this.current) throw new CallFailure('failed', '没有当前工作区');
    if (this.opened.has(ref)) return;
    this.opened.set(ref, { ref, snapshot: null });
    const resource = registry.define('workspace').resource(ref);
    resource.snapshot(() => this.opened.get(ref)?.snapshot ?? null);
    resource.command('refresh', {
      summary: '重新读取资源',
      args: {},
      run: () => this.refreshRef(ref),
    });
    void this.refreshRef(ref);
  }

  async refreshRef(ref: string): Promise<unknown> {
    if (!this.opened.has(ref)) return null;
    const snapshot = this.transport
      ? await this.transport.read(ref).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;
    this.opened.set(ref, { ref, snapshot });
    this.registry?.define('workspace').resource(ref).publish();
    return snapshot;
  }

  closeRef(ref: string): void {
    this.opened.delete(ref);
    this.registry?.define('workspace').remove(ref);
  }

  private publish(): void {
    this.registry?.define('workspace').resource('registry').publish();
  }
}

export function defineWorkspaceRegistryResource(
  registry: DomainRegistry,
  scope: WorkspaceScope,
): void {
  const resource = registry.define('workspace').resource('registry');
  resource.snapshot(() => scope.snapshot());
  resource.command('open', {
    summary: '打开工作区',
    args: { path: { type: 'string', required: true } },
    run: (input) => scope.open(String(input.path)),
  });
  resource.command('close', {
    summary: '关闭工作区',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      scope.close(String(input.id));
      return null;
    },
  });
  resource.command('rename', {
    summary: '重命名工作区',
    args: {
      id: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
    run: (input) => scope.rename(String(input.id), String(input.name)),
  });
  resource.command('remove', {
    summary: '移除工作区',
    args: { id: { type: 'string', required: true } },
    run: (input) => {
      scope.remove(String(input.id));
      return null;
    },
  });
  resource.command('openRef', {
    summary: '打开资源订阅地址',
    args: { ref: { type: 'string', required: true } },
    run: (input) => {
      scope.openRef(String(input.ref));
      return null;
    },
  });
  resource.command('closeRef', {
    summary: '关闭资源订阅地址',
    args: { ref: { type: 'string', required: true } },
    run: (input) => {
      scope.closeRef(String(input.ref));
      return null;
    },
  });
}

// ─── list ────────────────────────────────────────────────────

export interface ListState {
  snapshot: ListSnapshot | null;
}

export function createListState(): ListState {
  return { snapshot: null };
}

export function defineListResource(
  registry: DomainRegistry,
  state: ListState,
  service?: import('./lists.ts').ListService,
  context?: () => import('./lists.ts').ListProviderContext,
  openItem?: (item: ListItem) => Promise<unknown>,
): void {
  const resource = registry.define('workspace').resource('list');
  resource.snapshot(() => state.snapshot ?? { workspaceEpoch: 0, groups: [] });
  resource.command('refresh', {
    summary: '刷新列表投影',
    args: {},
    run: async () => {
      if (!service) return state.snapshot;
      state.snapshot = await service.refresh(
        context?.() ?? { workspacePath: '', workspaceId: '' },
      );
      resource.publish();
      return state.snapshot;
    },
  });
  resource.command('action', {
    summary: '执行列表动作',
    args: {
      action: { type: 'string', required: true },
      key: { type: 'string' },
    },
    run: openItem
      ? async (input) => {
          if (input.action !== 'open') {
            throw new CallFailure(
              'invalid',
              `不支持的列表动作：${input.action}`,
            );
          }
          const item = input.item;
          if (!item || typeof item !== 'object') {
            throw new CallFailure('invalid', '列表动作缺少 item');
          }
          return openItem(item as ListItem);
        }
      : pending('list/action'),
  });
}

// ─── search ──────────────────────────────────────────────────

export function defineSearchResource(
  registry: DomainRegistry,
  transport: TransportRouter,
  scope: () => { workspacePath: string; workspaceId: string },
): void {
  const resource = registry.define('workspace').resource('search');
  resource.snapshot(() => ({
    workspaceId: scope().workspaceId,
    workspacePath: scope().workspacePath,
    ready: Boolean(scope().workspacePath),
  }));
  resource.command('ls', {
    summary: '列出工作区结构',
    args: { ref: { type: 'string' } },
    run: (input) =>
      transport.ls(
        typeof input.ref === 'string' && input.ref
          ? input.ref
          : fileRefOf(scope().workspacePath),
      ),
  });
  resource.command('find', {
    summary: '按名称查找工作区资源',
    args: { query: { type: 'string', required: true } },
    run: (input) =>
      transport.find(fileRefOf(scope().workspacePath), String(input.query)),
  });
  resource.command('read', {
    summary: '读取工作区资源',
    args: { ref: { type: 'string', required: true } },
    run: (input) => transport.read(String(input.ref)),
  });
  resource.command('grep', {
    summary: '检索工作区内容',
    args: {
      query: { type: 'string', required: true },
      ref: { type: 'string' },
    },
    run: (input) =>
      transport.grep(
        typeof input.ref === 'string' && input.ref
          ? input.ref
          : fileRefOf(scope().workspacePath),
        String(input.query),
      ),
  });
}

function fileRefOf(path: string): string {
  if (!path) return 'file:///';
  return `file://${path.startsWith('/') ? path : `/${path}`}`;
}
