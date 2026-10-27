// ─── 集合（侧栏分组） ────────────────────────────────────────────────
//
// 侧栏是 workspace 的投影：每个 provider 贡献一组分组，shell 只渲染。
// provider 拿不到视图句柄与写通道，只能发现资源（tree / find）与读插件设置。

import {
  fileRef,
  type CollectionContext,
  type CollectionGroup,
  type CollectionView,
} from '../../shared/ura';
import type { PluginHost } from '../plugins/host';
import type { Ura } from './facade';
import { listRegistry } from '../app/lists/list-registry';

export class Collections {
  constructor(
    private readonly ura: Ura,
    private readonly host: PluginHost,
    private readonly workspace: () => string,
  ) {}

  context(owner: string): CollectionContext {
    return {
      workspace: fileRef(this.workspace()),
      tree: (ref, limit) => this.ura.tree(ref, limit),
      find: (pattern, options) => this.ura.find(pattern, options ?? {}),
      settings: {
        get: (key, fallback) => this.host.getSetting(owner, key, fallback),
      },
    };
  }

  async list(): Promise<CollectionView[]> {
    const views: CollectionView[] = [];
    for (const entry of listRegistry.providers()) {
      const ctx = this.context(entry.owner);
      let groups: CollectionGroup[] = [];
      try {
        const provided = await entry.provider(ctx);
        groups = provided.map((group) => ({
          id: group.id,
          title: group.label,
          ...(group.icon ? { icon: group.icon } : {}),
          ...(group.order !== undefined ? { order: group.order } : {}),
          items: group.items.map((item) => ({
            ref: item.key,
            title: item.title,
          })),
        }));
      } catch {
        continue;
      }
      views.push({
        source: entry.definition.id,
        owner: entry.owner,
        label: entry.definition.label,
        ...(entry.definition.icon ? { icon: entry.definition.icon } : {}),
        groups,
      });
    }
    return views;
  }
}
