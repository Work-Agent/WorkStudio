/**
 * workspace 模块持有的 System Domain：workspace · list。
 *
 * WorkspaceScope 是 Workspace 作用域的状态切片与操作；
 * 域只宣告资源与命令，切换 / 释放由模块生命周期驱动。
 */

import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { ResourceNode } from '../../../shared/resources.ts';
import { CallFailure } from '../../contract.ts';
import { pending } from '../../registry/command.ts';
import type { TransportRouter } from '../../transport/router.ts';
import { TransportAccess } from '../../transport/access.ts';
import { canonicalRef } from '../../transport/ref.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { WorkspaceRepository } from './repo.ts';

interface OpenedResource {
  workspaceId: string;
  ref: string;
  snapshot: unknown;
}

/** 资源地址：打开的资源挂在所属工作区下（`workspace/<wsId>/<ref>`）。 */
function refResourceName(workspaceId: string, ref: string): string {
  return `${workspaceId}/${ref}`;
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
      const opened = this.opened.get(update.resource);
      if (opened) void this.refreshRef(opened.workspaceId, opened.ref);
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
    const workspaceId = this.current?.id;
    if (workspaceId) this.releaseRefs(workspaceId);
    this.current = null;
    this.publish();
  }

  /** 只释放某个工作区的资源订阅。 */
  releaseRefs(workspaceId: string): void {
    for (const [name, opened] of this.opened) {
      if (opened.workspaceId !== workspaceId) continue;
      this.opened.delete(name);
      this.registry?.define('workspace').remove(name);
    }
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

  /** `workspace/<wsId>/<ref>`：打开的资源才建立订阅地址。 */
  openRef(workspaceId: string, inputRef: string): void {
    const registry = this.registry;
    if (!registry) throw new CallFailure('failed', '注册表未接入');
    if (!workspaceId) throw new CallFailure('failed', '没有当前工作区');
    const ref = canonicalRef(inputRef);
    const name = refResourceName(workspaceId, ref);
    if (this.opened.has(name)) return;
    this.opened.set(name, { workspaceId, ref, snapshot: null });
    const domain = registry.define('workspace');
    const resource = domain.resource(name);
    resource.snapshot(() => this.opened.get(name)?.snapshot ?? null);
    resource.command('refresh', {
      summary: '重新读取资源',
      args: {},
      run: () => this.refreshRef(workspaceId, ref),
    });
    // 内容页按裸 ref 订阅（`workspace/<ref>`）：同一份快照挂两个地址，
    // 免得多工作区同开一个 ref 时各自维护一份。
    if (!domain.resourceOf(ref)) {
      domain
        .resource(ref)
        .snapshot(() => this.opened.get(name)?.snapshot ?? null);
    }
    void this.refreshRef(workspaceId, ref);
  }

  async refreshRef(workspaceId: string, inputRef: string): Promise<unknown> {
    const ref = canonicalRef(inputRef);
    const name = refResourceName(workspaceId, ref);
    if (!this.opened.has(name)) return null;
    const snapshot = this.transport
      ? await this.transport.read(ref).catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;
    this.opened.set(name, { workspaceId, ref, snapshot });
    const domain = this.registry?.define('workspace');
    domain?.resource(name).publish();
    if (domain?.resourceOf(ref)) domain.resource(ref).publish();
    return snapshot;
  }

  closeRef(workspaceId: string, inputRef: string): void {
    const ref = canonicalRef(inputRef);
    const name = refResourceName(workspaceId, ref);
    this.opened.delete(name);
    const domain = this.registry?.define('workspace');
    domain?.remove(name);
    // 裸 ref 别名只在最后一个引用关闭时才撤。
    const stillOpen = [...this.opened.values()].some(
      (opened) => opened.ref === ref,
    );
    if (!stillOpen && domain?.resourceOf(ref)) domain.remove(ref);
  }

  private publish(): void {
    this.transport?.setWorkspaceRoots(
      [...this.known.values()].map((meta) => meta.path),
    );
    // 网页快照写在应用管理的 `sites/`：可写根跟着已知工作区一起更新。
    this.transport?.setWriteRoots(
      [...this.known.keys()].map((id) => this.repo.sitesDir(id)),
    );
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
    args: {
      ref: { type: 'string', required: true },
      workspaceId: { type: 'string' },
    },
    run: (input) => {
      const workspaceId =
        typeof input.workspaceId === 'string' && input.workspaceId
          ? input.workspaceId
          : (scope.current?.id ?? '');
      scope.openRef(workspaceId, String(input.ref));
      return null;
    },
  });
  resource.command('closeRef', {
    summary: '关闭资源订阅地址',
    args: {
      ref: { type: 'string', required: true },
      workspaceId: { type: 'string' },
    },
    run: (input) => {
      const workspaceId =
        typeof input.workspaceId === 'string' && input.workspaceId
          ? input.workspaceId
          : (scope.current?.id ?? '');
      scope.closeRef(workspaceId, String(input.ref));
      return null;
    },
  });
}

// ─── resources ──────────────────────────────────────────────

/** 工作区资源森林：每个工作区一份，地址 `workspace/<wsId>/resources`。 */
export function resourcesResourceName(workspaceId: string): string {
  return `${workspaceId}/resources`;
}

export function defineWorkspaceResourcesResource(
  registry: DomainRegistry,
  workspaceId: string,
  service: import('./resources.ts').ResourceForestService,
  context: () => import('./resources.ts').ResourceContext,
  openNode?: (node: ResourceNode, workspaceId: string) => Promise<unknown>,
  /** 结构操作（重命名 / 删除）交给传输层，域本身不碰文件系统。 */
  files?: {
    rename(ref: string, name: string): Promise<{ ref: string }>;
    remove(ref: string): Promise<void>;
  },
): void {
  const resource = registry
    .define('workspace')
    .resource(resourcesResourceName(workspaceId));
  resource.snapshot(() => service.current(workspaceId));
  resource.command('refresh', {
    summary: '刷新资源森林',
    args: {},
    run: async () => {
      const snapshot = await service.refresh(context());
      resource.publish();
      return snapshot;
    },
  });
  resource.command('rename', {
    summary: '重命名资源',
    args: {
      ref: { type: 'string', required: true },
      name: { type: 'string', required: true },
    },
    run: async (input) => {
      if (!files) throw new CallFailure('failed', '文件操作未接入');
      const result = await files.rename(String(input.ref), String(input.name));
      await service.refresh(context());
      resource.publish();
      return result;
    },
  });
  resource.command('remove', {
    summary: '删除资源',
    args: { ref: { type: 'string', required: true } },
    run: async (input) => {
      if (!files) throw new CallFailure('failed', '文件操作未接入');
      await files.remove(String(input.ref));
      await service.refresh(context());
      resource.publish();
      return null;
    },
  });
  resource.command('action', {
    summary: '执行资源动作',
    args: {
      action: { type: 'string', required: true },
      key: { type: 'string' },
    },
    run: openNode
      ? async (input) => {
          if (input.action !== 'open') {
            throw new CallFailure(
              'invalid',
              `不支持的资源动作：${input.action}`,
            );
          }
          const node = input.node;
          if (!node || typeof node !== 'object') {
            throw new CallFailure('invalid', '资源动作缺少 node');
          }
          return openNode(node as ResourceNode, workspaceId);
        }
      : pending('workspace/<wsId>/resources/action'),
  });
  resource.command('children', {
    summary: '读取树节点子项',
    args: {
      groupId: { type: 'string', required: true },
      key: { type: 'string', required: true },
    },
    run: (input) => {
      const groupId = String(input.groupId);
      const key = String(input.key);
      const group = service
        .current(workspaceId)
        .groups.find((item) => item.id === groupId);
      return findNode(group?.roots ?? [], key)?.children ?? [];
    },
  });
}

function findNode(nodes: ResourceNode[], key: string): ResourceNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    const found = findNode(node.children ?? [], key);
    if (found) return found;
  }
  return null;
}

// ─── search ──────────────────────────────────────────────────

export function searchResourceName(workspaceId: string): string {
  return `${workspaceId}/search`;
}

export function defineWorkspaceSearchResource(
  registry: DomainRegistry,
  workspaceId: string,
  transport: TransportRouter,
  pathOf: () => string,
): void {
  const resource = registry
    .define('workspace')
    .resource(searchResourceName(workspaceId));
  const scope = () => ({ workspaceId, workspacePath: pathOf() });
  // 页面 bridge 的 ls / find / read / grep 落到这四个命令上，与助手工具同源。
  const access = new TransportAccess(transport);
  resource.snapshot(() => ({
    workspaceId: scope().workspaceId,
    workspacePath: scope().workspacePath,
    ready: Boolean(scope().workspacePath),
  }));
  resource.command('ls', {
    summary: '列出工作区结构',
    args: { ref: { type: 'string' } },
    run: (input) =>
      access.ls(
        typeof input.ref === 'string' && input.ref
          ? input.ref
          : fileRefOf(scope().workspacePath),
      ),
  });
  resource.command('find', {
    summary: '按名称查找工作区资源',
    args: { query: { type: 'string', required: true } },
    run: (input) =>
      access.find(fileRefOf(scope().workspacePath), String(input.query)),
  });
  resource.command('read', {
    summary: '读取工作区资源',
    args: { ref: { type: 'string', required: true } },
    run: (input) => access.read(String(input.ref)),
  });
  resource.command('grep', {
    summary: '检索工作区内容',
    args: {
      query: { type: 'string', required: true },
      ref: { type: 'string' },
    },
    run: (input) =>
      access.grep(
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
