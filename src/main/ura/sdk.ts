// ─── WorkStudio SDK（插件入口使用的注册面） ───────────────────────────
//
// 插件在 ./ura 模块求值时调用这些函数，把自己提供的能力登记进应用级注册表。
// 注册是同步的、纯登记的：不打开资源、不解析内容。

import type {
  Codec,
  CollectionProvider,
  Presenter,
  SidecarProvider,
  Store,
  Transport,
  ViewAction,
} from '../../shared/ura';
import type { ListDefinition } from '../../shared/lists';
import { listRegistry, type ListProvider } from '../app/lists/list-registry';
import { uraRegistry } from './registry';

export function registerTransport(transport: Transport): void {
  uraRegistry.registerTransport(transport);
}

export function registerCodec(codec: Codec): void {
  uraRegistry.registerCodec(codec);
}

export function registerStore(store: Store): void {
  uraRegistry.registerStore(store);
}

/** 表现层：页面 / 浏览器。 */
export function registerPresenter(presenter: Presenter): void {
  uraRegistry.registerPresenter(presenter);
}

/** agent 读取面：文本 / schema。 */
export function registerSidecar(provider: SidecarProvider): void {
  uraRegistry.registerSidecar(provider);
}

export function registerCollection(provider: CollectionProvider): void {
  uraRegistry.registerCollection(provider);
}

export function registerViewAction(action: ViewAction): void {
  uraRegistry.registerViewAction(action);
}

/** 侧栏列表：定义 + 工作区 provider（Phase 4 扩展面）。 */
export function registerList(
  definition: ListDefinition,
  provider: ListProvider,
): void {
  listRegistry.register(definition, provider, 'plugin');
}
