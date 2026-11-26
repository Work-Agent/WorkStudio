/**
 * 资源树构建：transport 枚举本地文件，或插件提供自定义节点。
 *
 * 文件树是有界的：默认最多 800 个叶子、8 层目录，避免把整个仓库塞进侧栏。
 */

import type {
  PluginResourceGroup,
  ResourceContext,
  ResourceGroup,
  ResourceGroupDefinition,
  ResourceNode,
  ResourceSource,
} from '../../../shared/resources.ts';
import type { TransportRouter } from '../../transport/router.ts';

export interface TransportTreeOptions {
  include?: string[];
  exclude?: string[];
  maxNodes?: number;
  maxDepth?: number;
}

const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  'sites',
  'dist',
  'out',
  'test-results',
  'coverage',
]);

const DEFAULT_MAX_NODES = 800;
const DEFAULT_MAX_DEPTH = 8;

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
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const include = options.include?.length ? new Set(options.include) : null;
  const exclude = new Set([...DEFAULT_EXCLUDES, ...(options.exclude ?? [])]);
  const visited = new Set<string>();
  let count = 0;

  const walk = async (
    ref: string,
    relativePath: string,
    depth: number,
  ): Promise<ResourceNode[]> => {
    if (depth > maxDepth || count >= maxNodes) return [];
    if (visited.has(ref)) return [];
    visited.add(ref);
    const entries = await transport.ls(ref, { limit: 500 });
    const nodes: ResourceNode[] = [];
    for (const entry of entries) {
      if (count >= maxNodes) break;
      const name = entry.name;
      if (
        name.startsWith('.') ||
        name === 'AGENTS.md' ||
        exclude.has(name) ||
        (include && !include.has(name))
      ) {
        continue;
      }
      const childRelative = relativePath ? `${relativePath}/${name}` : name;
      if (entry.type === 'dir') {
        const children = await walk(entry.ref, childRelative, depth + 1);
        if (children.length === 0) continue;
        nodes.push({
          key: entry.ref,
          type: 'dir',
          title: name,
          meta: {
            ref: entry.ref,
            relativePath: childRelative,
            ...(entry.modifiedAt ? { updatedAt: entry.modifiedAt } : {}),
          },
          children,
        });
        continue;
      }
      if (entry.type !== 'file') continue;
      count += 1;
      nodes.push({
        key: entry.ref,
        type: 'file',
        title: name,
        meta: {
          ref: entry.ref,
          relativePath: childRelative,
          source: 'docs',
          sourceLabel: '本地文档',
          ...(entry.modifiedAt ? { updatedAt: entry.modifiedAt } : {}),
        },
        actions: ['open'],
      });
    }
    return nodes;
  };

  const roots = await walk(rootRef, '', 0);
  return { roots, count };
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
