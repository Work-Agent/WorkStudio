/**
 * 传输路由：ref → 域 → ResourceAdapter。
 *
 * 只有域知道怎么枚举与解析自己的资源；框架在域省略 ls / find 时
 * 回退到工作区文件枚举，不为任何格式增加分支。
 */

import { CallFailure } from '../contract.ts';
import type {
  Claim,
  Entry,
  Item,
  ListOptions,
  OpenTarget,
  ReadOptions,
  ResourceAdapter,
  ResourceRoot,
} from './resource.ts';
import { matchesClaim } from './resource.ts';
import type { WorkspaceFiles } from './workspace-files.ts';

interface Registration {
  domain: string;
  adapter: ResourceAdapter;
  claims: readonly Claim[];
  order: number;
}

/** 结果有界：框架只限条数，不切片字段、不做文本化。 */
const MAX_ITEMS = 500;

export class TransportRouter {
  private readonly registrations: Registration[] = [];
  private order = 0;

  constructor(private readonly workspace: WorkspaceFiles) {}

  /** 工作区切换：文件适配器换根，其它来源不受影响。 */
  setWorkspaceRoot(root: string): void {
    this.workspace.setRoot(root);
  }

  /** 已登记的工作区根：读操作可跨工作区（多窗口并行）。 */
  setWorkspaceRoots(roots: readonly string[]): void {
    this.workspace.setRoots(roots);
  }

  /** 域注册自己的传输适配器；同一域可覆盖旧实现（热更新）。 */
  register(
    domain: string,
    adapter: ResourceAdapter,
    claims: readonly Claim[],
  ): void {
    this.registrations.push({
      domain,
      adapter,
      claims,
      order: this.order++,
    });
  }

  /** 热卸载：撤下该域的全部适配器。 */
  revoke(domain: string): void {
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      if (this.registrations[index]!.domain === domain) {
        this.registrations.splice(index, 1);
      }
    }
  }

  /** 已登记适配器的资源根自述；没有 describe 的按 claims 前缀兜底。 */
  resourceRoots(): ResourceRoot[] {
    const roots: ResourceRoot[] = [];
    for (const registration of this.registrations) {
      try {
        const described = registration.adapter.describe?.();
        if (described) {
          roots.push(...(Array.isArray(described) ? described : [described]));
          continue;
        }
      } catch {
        // 单个适配器描述失败不影响其他根。
      }
      for (const claim of registration.claims) {
        for (const prefix of claim.prefixes ?? []) {
          roots.push({
            root: prefix,
            label: registration.domain,
            // 兜底根如实说明支持的动作，避免模型对 ls 产生错误预期。
            summary: registration.adapter.ls
              ? '资源根；用 ls 查看结构'
              : '资源根；用 read / grep 访问',
          });
        }
      }
    }
    return roots;
  }

  resolve(ref: string): { domain: string; adapter: ResourceAdapter } | null {
    const top = this.claimants(ref)[0];
    return top ? { domain: top.domain, adapter: top.adapter } : null;
  }

  /** 认领该 ref 的全部适配器：优先级高的在前，同一优先级按登记顺序。 */
  private claimants(ref: string): Registration[] {
    return this.registrations
      .map((registration) => ({
        registration,
        priority: claimPriority(ref, registration.claims),
      }))
      .filter((item) => item.priority >= 0)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.registration.order - b.registration.order,
      )
      .map((item) => item.registration);
  }

  /**
   * 结构是聚合视图：认领同一 ref 的适配器并发执行，结果按 ref 合并去重。
   * 单个来源失败不拖垮整层，全部失败才把错误抛出来。
   */
  async ls(ref: string, options?: ListOptions): Promise<Entry[]> {
    const claimants = this.claimants(ref);
    if (claimants.length === 0) {
      return bound(await this.workspace.ls(ref, options));
    }
    const lists = await Promise.allSettled(
      claimants
        .filter((claimant) => claimant.adapter.ls)
        .map((claimant) => claimant.adapter.ls!(ref, options)),
    );
    return bound(mergeEntries(lists));
  }

  async find(ref: string, query: string): Promise<Entry[]> {
    const claimants = this.claimants(ref);
    if (claimants.length === 0) {
      return bound(await this.workspace.find(ref, query));
    }
    const lists = await Promise.allSettled(
      claimants
        .filter((claimant) => claimant.adapter.find)
        .map((claimant) => claimant.adapter.find!(ref, query)),
    );
    return bound(mergeEntries(lists));
  }

  async read(ref: string, options?: ReadOptions): Promise<Item[]> {
    const target = this.resolve(ref);
    if (!target) {
      throw new CallFailure('not_found', `没有可读取的域：${ref}`);
    }
    return bound(await target.adapter.read(ref, options));
  }

  async grep(ref: string, query: string): Promise<Item[]> {
    const target = this.resolve(ref);
    if (!target) {
      throw new CallFailure('not_found', `没有可检索的域：${ref}`);
    }
    return bound(await target.adapter.grep(ref, query));
  }

  /** 解析打开目标；adapter 不知道窗口，只返回 ref / locator。 */
  async open(ref: string, locator?: string): Promise<OpenTarget> {
    const target = this.resolve(ref);
    if (target?.adapter.open) {
      const opened = await target.adapter.open(ref, locator);
      if (opened) return opened;
    }
    return locator ? { ref, locator } : { ref };
  }

  /** 结构操作：重命名 / 删除，只对本地文件有效。 */
  rename(ref: string, name: string): Promise<{ ref: string }> {
    return this.workspace.renameRef(ref, name);
  }

  remove(ref: string): Promise<void> {
    return this.workspace.removeRef(ref);
  }

  /** 插件上下文的原始字节读写；不经过格式层。 */
  readBytes(ref: string): Promise<Uint8Array> {
    return this.workspace.readBytes(ref);
  }

  writeBytes(ref: string, bytes: Uint8Array): Promise<void> {
    return this.workspace.writeBytes(ref, bytes);
  }
}

function claimPriority(ref: string, claims: readonly Claim[]): number {
  let best = -1;
  for (const claim of claims) {
    if (!matchesClaim(ref, claim)) continue;
    best = Math.max(best, claim.priority ?? 0);
  }
  return best;
}

function bound<T>(items: T[]): T[] {
  return items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS) : items;
}

/** 多来源合并：同一 ref 只保留第一个（优先级高的在前），全部失败则抛错。 */
function mergeEntries(results: Array<PromiseSettledResult<Entry[]>>): Entry[] {
  if (
    results.length > 0 &&
    results.every((result) => result.status === 'rejected')
  ) {
    const first = results[0];
    throw first.status === 'rejected'
      ? first.reason
      : new Error('结构聚合失败');
  }
  const seen = new Set<string>();
  const merged: Entry[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const entry of result.value) {
      if (seen.has(entry.ref)) continue;
      seen.add(entry.ref);
      merged.push(entry);
    }
  }
  return merged;
}
