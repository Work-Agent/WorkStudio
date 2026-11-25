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
  ReadOptions,
  ResourceAdapter,
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

  resolve(ref: string): { domain: string; adapter: ResourceAdapter } | null {
    const candidates = this.registrations
      .map((registration) => ({
        registration,
        priority: claimPriority(ref, registration.claims),
      }))
      .filter((item) => item.priority >= 0)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.registration.order - b.registration.order,
      );
    const top = candidates[0];
    return top
      ? { domain: top.registration.domain, adapter: top.registration.adapter }
      : null;
  }

  async ls(ref: string, options?: ListOptions): Promise<Entry[]> {
    const target = this.resolve(ref);
    const items = target?.adapter.ls
      ? await target.adapter.ls(ref, options)
      : await this.workspace.ls(ref, options);
    return bound(items);
  }

  async find(ref: string, query: string): Promise<Entry[]> {
    const target = this.resolve(ref);
    const items = target?.adapter.find
      ? await target.adapter.find(ref, query)
      : await this.workspace.find(ref, query);
    return bound(items);
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
