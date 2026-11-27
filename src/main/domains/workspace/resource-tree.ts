/**
 * 资源树构建：transport 枚举本地文件，或插件提供自定义节点。
 *
 * 遍历本身是 `transport/listing.ts` 的整树实现——页面资源树与助手的
 * ls / find 共用同一套可见性、去重与并发规则；这里只把树投影成
 * 侧栏需要的节点形状。
 */

import type {
  PluginResourceGroup,
  ResourceContext,
  ResourceGroup,
  ResourceGroupDefinition,
  ResourceNode,
  ResourceSource,
} from '../../../shared/resources.ts';
import { listTree, type TreeNode } from '../../transport/listing.ts';
import type { TransportRouter } from '../../transport/router.ts';

export interface TransportTreeOptions {
  include?: string[];
  exclude?: string[];
  maxNodes?: number;
  maxDepth?: number;
}

/** 工作区路径 → file:// ref。 */
export function fileRef(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return `file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

export async function buildTransportRoots(
  transport: TransportRouter,
  rootRef: string,
  options: TransportTreeOptions = {},
): Promise<{ roots: ResourceNode[]; count: number }> {
  const tree = await listTree(transport, rootRef, options);
  return {
    roots: tree.roots.map((node) => projectNode(node, '')),
    count: tree.count,
  };
}

function projectNode(node: TreeNode, parentPath: string): ResourceNode {
  const entry = node.entry;
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const meta = {
    ref: entry.ref,
    relativePath,
    ...(entry.modifiedAt ? { updatedAt: entry.modifiedAt } : {}),
  };
  if (entry.type === 'dir') {
    return {
      key: entry.ref,
      type: 'dir',
      title: entry.name,
      meta,
      children: node.children.map((child) => projectNode(child, relativePath)),
    };
  }
  return {
    key: entry.ref,
    type: 'file',
    title: entry.name,
    meta: { ...meta, source: 'docs', sourceLabel: '本地文档' },
    actions: ['open'],
  };
}

export function countLeaves(nodes: readonly ResourceNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.children?.length) count += countLeaves(node.children);
    else count += 1;
  }
  return count;
}

export function makeResourceGroup(
  definition: ResourceGroupDefinition,
  roots: ResourceNode[],
  count = countLeaves(roots),
): ResourceGroup {
  return {
    id: definition.id,
    definitionId: definition.id,
    section: definition.section ?? 'resources',
    label: definition.label,
    ...(definition.icon ? { icon: definition.icon } : {}),
    ...(definition.tone ? { tone: definition.tone } : {}),
    ...(definition.unit ? { unit: definition.unit } : {}),
    count,
    countLabel: definition.countLabel ?? `${count} ${definition.unit ?? '项'}`,
    updatedAt: 0,
    order: definition.order ?? 0,
    state: 'ready',
    fields: definition.fields,
    actions: definition.actions,
    ...(definition.empty ? { empty: definition.empty } : {}),
    roots,
  };
}

export async function resolvePluginResourceGroup(
  group: PluginResourceGroup,
  context: ResourceContext,
  transport: TransportRouter,
): Promise<ResourceGroup> {
  const source: ResourceSource = group.source;
  if (source.type === 'custom') {
    const roots = await source.provider(context);
    return makeResourceGroup(group.definition, roots);
  }
  const { roots, count } = await buildTransportRoots(transport, source.ref, {
    ...(source.include ? { include: source.include } : {}),
    ...(source.exclude ? { exclude: source.exclude } : {}),
  });
  return makeResourceGroup(group.definition, roots, count);
}
