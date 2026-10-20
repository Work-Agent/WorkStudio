// ─── 集合（侧栏分组） ────────────────────────────────────────────────
//
// 侧栏是 workspace 的投影：每个 provider 贡献一组分组，shell 只渲染。
// provider 拿不到视图句柄与写通道，只能发现资源（tree / find）与读插件设置。

import type {
  CollectionContext,
  CollectionGroup,
  CollectionView,
} from '../../shared/ura'
import type { PluginHost } from '../plugins/host'
import type { Ura } from './facade'
import { uraRegistry } from './registry'

export class Collections {
  constructor(
    private readonly ura: Ura,
    private readonly host: PluginHost,
    private readonly workspace: () => string,
  ) {}

  async list(): Promise<CollectionView[]> {
    const workspace = `file://${this.workspace().replace(/\/$/, '')}`
    const views: CollectionView[] = []
    for (const { provider, owner } of uraRegistry.collectionProviders()) {
      const ctx: CollectionContext = {
        workspace,
        tree: (ref, limit) => this.ura.tree(ref, limit),
        find: (pattern, options) =>
          this.ura.find(pattern, options ?? {}),
        settings: {
          get: (key, fallback) => this.host.getSetting(owner, key, fallback),
        },
      }
      let groups: CollectionGroup[] = []
      try {
        groups = await provider.list(ctx)
      } catch {
        continue
      }
      views.push({
        source: provider.id,
        owner,
        label: provider.label,
        ...(provider.icon ? { icon: provider.icon } : {}),
        groups: groups.map((group) => ({
          ...group,
          items: [...group.items],
        })),
      })
    }
    return views
  }
}
