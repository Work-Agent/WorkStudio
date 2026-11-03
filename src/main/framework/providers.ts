/**
 * 页面提供者注册表：路径模式 → 内容视图规格。
 *
 * 只有 owner 模块能打开自己认领的路径；宿主按最具体的模式匹配。
 */

import { match, specificity } from '../core/paths';
import type { ViewProvider } from '../core/types';

/** 注册后的提供者：owner 由注册它的 service 决定。 */
export interface RegisteredProvider extends ViewProvider {
  serviceId: string;
}

interface Entry {
  provider: RegisteredProvider;
  order: number;
  score: number;
}

export class ProviderRegistry {
  private readonly entries: Entry[] = [];
  private order = 0;

  register(provider: RegisteredProvider): void {
    if (this.entries.some((entry) => entry.provider.path === provider.path)) {
      throw new Error(
        `duplicate view provider path "${provider.path}" (service ${provider.serviceId})`,
      );
    }
    this.entries.push({
      provider,
      order: (this.order += 1),
      score: specificity(provider.path),
    });
  }

  /** 最具体的模式优先；同分按注册顺序。 */
  match(path: string): RegisteredProvider | null {
    let best: Entry | null = null;
    for (const entry of this.entries) {
      if (!match(entry.provider.path, path)) continue;
      if (!best || better(entry, best)) best = entry;
    }
    return best?.provider ?? null;
  }
}

function better(left: Entry, right: Entry): boolean {
  if (left.score !== right.score) return left.score > right.score;
  if (left.provider.path.length !== right.provider.path.length) {
    return left.provider.path.length > right.provider.path.length;
  }
  return left.order < right.order;
}
