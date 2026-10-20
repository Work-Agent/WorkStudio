// ─── URA 装配 ────────────────────────────────────────────────────────
//
// 来源先注册，插件后装载，门面最后构造：注册表是应用级单例，
// 运行期只查表，不再装载。

import { PluginHost } from '../plugins/host'
import { BUILTIN_PLUGINS } from '../plugins/builtin'
import { Collections } from './collections'
import { docsCollection } from './collections/docs'
import { Ura } from './facade'
import { ResourcePipeline } from './pipeline'
import { uraRegistry } from './registry'
import { FileTransport } from './transports/fs'

export interface UraRuntime {
  registry: typeof uraRegistry
  pipeline: ResourcePipeline
  ura: Ura
  host: PluginHost
  collections: Collections
}

export async function createUraRuntime(options: {
  pluginRoots: string[]
  dataRoot: string
  workspace: () => string
}): Promise<UraRuntime> {
  await uraRegistry.runAs('system', async () => {
    uraRegistry.registerTransport(new FileTransport())
  })

  const host = new PluginHost({
    roots: options.pluginRoots,
    builtins: BUILTIN_PLUGINS,
    dataRoot: options.dataRoot,
    registry: uraRegistry,
  })
  await host.start()
  await uraRegistry.runAs('system', async () => {
    uraRegistry.registerCollection(docsCollection())
  })

  const pipeline = new ResourcePipeline(uraRegistry)
  const ura = new Ura(pipeline, uraRegistry, (surface, owner) =>
    host.pageFor(surface, owner),
  )
  const collections = new Collections(ura, host, options.workspace)
  return { registry: uraRegistry, pipeline, ura, host, collections }
}
