/**
 * 结构视图：一层列举与整树遍历的唯一实现。
 *
 * 页面资源树与助手的 ls / find 都从这里取结构，可见性、去重与并发宽度
 * 只有一份定义。传输层只负责把 ref 交给认领它的适配器；「哪些条目算
 * 噪声」属于视图，不属于某个适配器。
 */

import type { Entry } from './resource.ts';
import type { TransportRouter } from './router.ts';

/** 结构遍历的预算：默认最多 800 个叶子、8 层目录。 */
export const DEFAULT_MAX_NODES = 800;
export const DEFAULT_MAX_DEPTH = 8;
/** 同时在跑的 ls 数量：一个目录宽，不代表可以无限铺开。 */
const LIST_CONCURRENCY = 8;

/** 构建产物与运行时目录：结构视图里一律不出现。 */
const IGNORED_NAMES = new Set([
  'node_modules',
  'sites',
  'dist',
  'out',
  'test-results',
  'coverage',
]);

/** 会话上下文里 AGENTS.md 是虚拟资源地图，同名的真实文件不重复露出。 */
const SHADOWED_NAMES = new Set(['AGENTS.md']);

export interface ListingOptions {
  limit?: number;
  /** 只保留这些名字；缺省不限制。 */
  include?: readonly string[];
  /** 追加排除的名字。 */
  exclude?: readonly string[];
}

/** 遍历出的节点：只有一层结构与子节点，投影成什么形状由调用方决定。 */
export interface TreeNode {
  entry: Entry;
  children: TreeNode[];
}

export interface TreeResult {
  roots: TreeNode[];
  count: number;
}

/** 一层列举：聚合传输层结果后套同一套可见性规则。 */
export async function listEntries(
  transport: TransportRouter,
  ref: string,
  options: ListingOptions = {},
): Promise<Entry[]> {
  const { limit } = options;
  const entries = await transport.ls(ref, limit === undefined ? {} : { limit });
  return entries.filter((entry) => visible(entry.name, options));
}

/** 按名字过滤结构条目，可见性规则与 listEntries 一致。 */
export async function findEntries(
  transport: TransportRouter,
  ref: string,
  query: string,
): Promise<Entry[]> {
  const entries = await transport.find(ref, query);
  return entries.filter((entry) => visible(entry.name, {}));
}

/** 整树遍历：同一层的子目录并发展开，预算按叶子计数。 */
export async function listTree(
  transport: TransportRouter,
  rootRef: string,
  options: ListingOptions & { maxNodes?: number; maxDepth?: number } = {},
): Promise<TreeResult> {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const gate = createGate(LIST_CONCURRENCY);
  const visited = new Set<string>();
  let count = 0;

  const walk = async (ref: string, depth: number): Promise<TreeNode[]> => {
    if (depth > maxDepth || count >= maxNodes) return [];
    if (visited.has(ref)) return [];
    visited.add(ref);
    const entries = await gate(() => listEntries(transport, ref, options));
    const nodes = await Promise.all(
      entries.map(async (entry): Promise<TreeNode | null> => {
        if (count >= maxNodes) return null;
        if (entry.type === 'dir') {
          const children = await walk(entry.ref, depth + 1);
          // 空目录不进树：没有叶子就不占预算。
          return children.length ? { entry, children } : null;
        }
        if (entry.type !== 'file') return null;
        count += 1;
        return { entry, children: [] };
      }),
    );
    return nodes.filter((node): node is TreeNode => node !== null);
  };

  const roots = await walk(rootRef, 0);
  return { roots, count };
}

function visible(name: string, options: ListingOptions): boolean {
  if (!name || name.startsWith('.')) return false;
  if (SHADOWED_NAMES.has(name)) return false;
  if (IGNORED_NAMES.has(name)) return false;
  if (options.exclude?.includes(name)) return false;
  if (options.include?.length && !options.include.includes(name)) return false;
  return true;
}

/** 有界并发：同一层宽目录不会把适配器同时打满。 */
function createGate(width: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= width) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await run();
    } finally {
      release();
    }
  };
}
