// ─── URA 装配 ────────────────────────────────────────────────────────
//
// 来源先注册，插件后装载，门面最后构造：注册表是应用级单例，
// 运行期只查表，不再装载。

import { registerBrowserFeatures } from '../capabilities/browser/features';
import { BindingStore } from './bindings';
import { PluginHost } from '../plugins/host';
import { BUILTIN_PLUGINS } from '../plugins/builtin';
import { CollectionContexts } from './contexts';
import { listRegistry } from '../app/lists/list-registry';
import { docsDefinition, docsProvider } from '../app/lists/builtins/docs';
import { Ura } from './facade';
import { ResourcePipeline } from './pipeline';
import { ResourceMap } from './resource-map';
import { uraRegistry } from './registry';
import { FileTransport } from './transports/fs';
import { HttpTransport } from './transports/http';

export interface UraRuntime {
  registry: typeof uraRegistry;
  pipeline: ResourcePipeline;
  ura: Ura;
  host: PluginHost;
  contexts: CollectionContexts;
  map: ResourceMap;
}

export async function createUraRuntime(options: {
  pluginRoots: string[];
  dataRoot: string;
  bindingFile?: string;
  workspace: () => string;
}): Promise<UraRuntime> {
  await uraRegistry.runAs('system', async () => {
    uraRegistry.registerTransport(new FileTransport());
    uraRegistry.registerTransport(new HttpTransport('http'));
    uraRegistry.registerTransport(new HttpTransport('https'));
  });

  const host = new PluginHost({
    roots: options.pluginRoots,
    builtins: BUILTIN_PLUGINS,
    dataRoot: options.dataRoot,
    registry: uraRegistry,
  });
  await host.start();
  await uraRegistry.runAs('system', async () => {
    listRegistry.register(docsDefinition, docsProvider, 'system');
  });
  await uraRegistry.runAs('browser', async () => {
    registerBrowserFeatures();
  });

  const bindingStore = options.bindingFile
    ? new BindingStore(options.bindingFile)
    : undefined;
  if (bindingStore) uraRegistry.setBindings(await bindingStore.load());

  const pipeline = new ResourcePipeline(uraRegistry);
  const ura = new Ura(
    pipeline,
    uraRegistry,
    (surface, owner) => host.pageFor(surface, owner),
    bindingStore,
  );
  const contexts = new CollectionContexts(ura, host, options.workspace);
  const map = new ResourceMap(ura, uraRegistry, options.workspace);
  map.setSource(async () => {
    const groups = [];
    for (const entry of listRegistry.providers()) {
      try {
        const provided = await entry.provider(contexts.context(entry.owner));
        groups.push(
          ...provided.map((group) => ({
            label: `${entry.definition.label} · ${group.label}`,
            items: group.items.map((item) => ({
              ref: item.key,
              title: item.title,
            })),
          })),
        );
      } catch {
        continue;
      }
    }
    return groups;
  });
  await map.start();
  return { registry: uraRegistry, pipeline, ura, host, contexts, map };
}
