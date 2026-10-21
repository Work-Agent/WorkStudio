// ─── URA 装配 ────────────────────────────────────────────────────────
//
// 来源先注册，插件后装载，门面最后构造：注册表是应用级单例，
// 运行期只查表，不再装载。

import { registerBrowserFeatures } from '../browser-features'
import { PluginHost } from '../plugins/host'
import { BUILTIN_PLUGINS } from '../plugins/builtin'
import { Collections } from './collections'
import { docsCollection } from './collections/docs'
import { Ura } from './facade'
import { ResourcePipeline } from './pipeline'
import { ResourceMap } from './resource-map'
import { uraRegistry } from './registry'
import { FileTransport } from './transports/fs'
import { HttpTransport } from './transports/http'

export interface UraRuntime {
  registry: typeof uraRegistry
  pipeline: ResourcePipeline
  ura: Ura
  host: PluginHost
  collections: Collections
  map: ResourceMap
}

export async function createUraRuntime(options: {
  pluginRoots: string[]
  dataRoot: string
  workspace: () => string
}): Promise<UraRuntime> {
  await uraRegistry.runAs('system', 'system', async () => {
    uraRegistry.registerTransport(new FileTransport())
    uraRegistry.registerTransport(new HttpTransport('http'))
    uraRegistry.registerTransport(new HttpTransport('https'))
  })

  const host = new PluginHost({
    roots: options.pluginRoots,
    builtins: BUILTIN_PLUGINS,
    dataRoot: options.dataRoot,
    registry: uraRegistry,
  })
  await host.start()
  await uraRegistry.runAs('system', 'system', async () => {
    uraRegistry.registerCollection(docsCollection())
  })
  await uraRegistry.runAs('browser', 'system', async () => {
    registerBrowserFeatures()
  })

  const pipeline = new ResourcePipeline(uraRegistry)
  const ura = new Ura(pipeline, uraRegistry, (surface, owner) =>
    host.pageFor(surface, owner),
  )
  const collections = new Collections(ura, host, options.workspace)
  const map = new ResourceMap(ura, collections, uraRegistry, options.workspace)
  await map.start()
  return { registry: uraRegistry, pipeline, ura, host, collections, map }
}
