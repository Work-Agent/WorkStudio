// ─── 内置集合：本地文档 ──────────────────────────────────────────────
//
// 工作区内不被其他 provider 认领的文件（sites/ 归浏览器插件）。

import type { CollectionProvider } from '../../../shared/ura'

export function docsCollection(): CollectionProvider {
  return {
    id: 'docs',
    label: '本地文档',
    async list(ctx) {
      const items = (await ctx.tree(ctx.workspace, 500))
        .filter(
          (item) =>
            item.kind === 'file' &&
            !item.ref.includes('/sites/') &&
            !item.name.startsWith('.'),
        )
        .map((item) => ({ ref: item.ref, title: item.name }))
      return items.length ? [{ id: 'docs', title: '本地文档', items }] : []
    },
  }
}
