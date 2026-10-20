// ─── WorkStudio SDK（插件入口使用的注册面） ───────────────────────────
//
// 插件在 ./ura 模块求值时调用这些函数，把自己提供的能力登记进应用级注册表。
// 注册是同步的、纯登记的：不打开资源、不解析内容。

import type { Codec, CollectionProvider, Consumer, Store, Transport, ViewAction } from '../../shared/ura'
import { uraRegistry } from './registry'

export function registerTransport(transport: Transport): void {
  uraRegistry.registerTransport(transport)
}

export function registerCodec(codec: Codec): void {
  uraRegistry.registerCodec(codec)
}

export function registerStore(store: Store): void {
  uraRegistry.registerStore(store)
}

export function registerConsumer(consumer: Consumer): void {
  uraRegistry.registerConsumer(consumer)
}

export function registerCollection(provider: CollectionProvider): void {
  uraRegistry.registerCollection(provider)
}

export function registerViewAction(action: ViewAction): void {
  uraRegistry.registerViewAction(action)
}
