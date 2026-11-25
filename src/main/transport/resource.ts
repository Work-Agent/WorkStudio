/**
 * 资源适配器：唯一事实源在 @work-studio/sdk。
 *
 * 框架只做路由：ref → 域 → adapter；这里的 matchesClaim 是宿主侧
 * 的认领匹配，不进入插件 SDK。
 */

import type { Claim } from '@work-studio/sdk';

export type {
  Claim,
  Entry,
  Item,
  ListOptions,
  Locator,
  ReadOptions,
  ResourceAdapter,
} from '@work-studio/sdk';

export function matchesClaim(ref: string, claim: Claim): boolean {
  if (claim.prefixes?.some((prefix) => ref.startsWith(prefix))) return true;
  const extensions = claim.extensions;
  if (!extensions?.length) return false;
  const path = ref.split(/[?#]/, 1)[0] ?? ref;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  return extensions.includes(path.slice(dot + 1).toLowerCase());
}
