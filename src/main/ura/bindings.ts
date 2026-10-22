// ─── 绑定配置（transport × MIME → codec / presenter） ────────────────
//
// 用户覆盖优先于默认解析；文件损坏时回落空表，不影响启动。

import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Binding } from '../../shared/ura'

export class BindingStore {
  constructor(readonly file: string) {}

  async load(): Promise<Binding[]> {
    const raw = await readFile(this.file, 'utf-8').catch(() => null)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as { bindings?: Binding[] }
      return Array.isArray(parsed.bindings) ? parsed.bindings : []
    } catch {
      return []
    }
  }

  async save(bindings: Binding[]): Promise<void> {
    const tmp = `${this.file}.tmp`
    await writeFile(
      tmp,
      `${JSON.stringify({ bindings }, null, 2)}\n`,
      'utf-8',
    )
    await rename(tmp, this.file)
  }
}
