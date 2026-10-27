// ─── 列表上下文工厂 ──────────────────────────────────────────────────
//
// 列表 provider 拿不到视图句柄与写通道，只能发现资源（tree / find）与读插件设置。

import { fileRef, type ListContext } from '../../shared/ura';
import type { PluginHost } from '../plugins/host';
import type { Ura } from './facade';

export class ListContexts {
  constructor(
    private readonly ura: Ura,
    private readonly host: PluginHost,
    private readonly workspace: () => string,
  ) {}

  context(owner: string): ListContext {
    return {
      workspace: fileRef(this.workspace()),
      tree: (ref, limit) => this.ura.tree(ref, limit),
      find: (pattern, options) => this.ura.find(pattern, options ?? {}),
      icon: (ref) => {
        const pluginId = this.ura.ownerForRef(ref);
        const pkg = pluginId ? this.host.get(pluginId) : undefined;
        return pkg?.iconUrl ?? pkg?.icon;
      },
      settings: {
        get: (key, fallback) => this.host.getSetting(owner, key, fallback),
      },
    };
  }
}
