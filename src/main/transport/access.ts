/**
 * 取数面的宿主实现：助手工具、页面 bridge、插件上下文都落到这里。
 *
 * 四个动词只认资源 ref；结构走 listing（聚合 + 可见性），内容走适配器。
 * 写不在这里——写是命令，由技能说明。
 */

import type { ResourceAccess } from '@work-studio/sdk';
import type { Entry, Item, ListOptions, ReadOptions } from './resource.ts';
import { findEntries, listEntries } from './listing.ts';
import type { TransportRouter } from './router.ts';

export class TransportAccess implements ResourceAccess {
  constructor(private readonly transport: TransportRouter) {}

  ls(ref: string, options?: ListOptions): Promise<Entry[]> {
    return listEntries(this.transport, ref, options ?? {});
  }

  find(ref: string, query: string): Promise<Entry[]> {
    return findEntries(this.transport, ref, query);
  }

  read(ref: string, options?: ReadOptions): Promise<Item[]> {
    return this.transport.read(ref, options);
  }

  grep(ref: string, query: string): Promise<Item[]> {
    return this.transport.grep(ref, query);
  }
}
