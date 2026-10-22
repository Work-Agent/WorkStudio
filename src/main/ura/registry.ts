// ─── URA 注册表 ──────────────────────────────────────────────────────
//
// 四张表：来源（按协议）· 格式（按文档类型）· 数据（按文档类型）· 出口（按类型 × 侧）。
// 注册是同步的、纯登记的；冲突按后注册者胜出并进诊断，不做静默合并。

import type {
  Binding,
  Codec,
  CollectionProvider,
  Consumer,
  DocType,
  Intent,
  Mime,
  Store,
  Transport,
  TransportId,
  ViewAction,
} from '../../shared/ura'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface Diagnostic {
  level: DiagnosticLevel
  code: string
  message: string
}

interface Entry<T> {
  impl: T
  owner: string
  order: number
}

const DOC_TYPE_PATTERN = /^[a-z][a-z0-9._-]*@\d+$/i
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i

export class UraRegistry {
  private readonly transports = new Map<string, Entry<Transport>>()
  private readonly codecs = new Map<DocType, Entry<Codec>>()
  private readonly codecsByMime = new Map<Mime, Entry<Codec>[]>()
  private bindings: Binding[] = []
  private readonly stores = new Map<DocType, Entry<Store>>()
  private readonly consumers = new Map<string, Entry<Consumer>[]>()
  private readonly consumersByMime = new Map<string, Entry<Consumer>[]>()
  private readonly collections = new Map<string, Entry<CollectionProvider>>()
  private readonly actions = new Map<string, Entry<ViewAction>>()
  private readonly logs: Diagnostic[] = []
  private owner: string | null = null
  private order = 0

  // ─── 归属上下文 ────────────────────────────────────────────────
  // 插件入口在模块求值时注册；宿主在 import 期间置入归属，注册项据此记名。

  async runAs<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.owner
    this.owner = owner
    try {
      return await fn()
    } finally {
      this.owner = previous
    }
  }

  currentOwner(): string {
    return this.owner ?? 'unknown'
  }

  // ─── 注册 ──────────────────────────────────────────────────────

  registerTransport(transport: Transport): void {
    const scheme = transport.scheme
    if (!SCHEME_PATTERN.test(scheme)) {
      this.reject('transport.invalid-scheme', `来源协议非法：${scheme}`)
      return
    }
    if (
      typeof transport.stat !== 'function' ||
      typeof transport.read !== 'function' ||
      typeof transport.write !== 'function' ||
      typeof transport.list !== 'function'
    ) {
      this.reject('transport.incomplete', `来源缺少 stat/read/write/list：${scheme}`)
      return
    }
    if (this.transports.has(scheme)) {
      this.warn('transport.override', `来源被覆盖：${scheme}`)
    }
    this.transports.set(scheme, this.entry(transport))
    this.info('transport.registered', `来源注册：${scheme}`)
  }

  registerCodec(codec: Codec): void {
    if (!DOC_TYPE_PATTERN.test(codec.docType)) {
      this.reject('codec.invalid-doc-type', `文档类型非法：${codec.docType}`)
      return
    }
    if (!codec.mime?.length) {
      this.reject('codec.no-mime', `格式缺少 MIME：${codec.docType}`)
      return
    }
    if (!codec.hints.length) {
      this.reject('codec.no-hints', `格式缺少提示：${codec.docType}`)
      return
    }
    if (codec.patchType !== 'text' && codec.patchType !== 'bytes') {
      this.reject('codec.invalid-patch-type', `补丁形态非法：${codec.docType}`)
      return
    }
    if (
      typeof codec.decode !== 'function' ||
      typeof codec.locate !== 'function' ||
      typeof codec.encode !== 'function'
    ) {
      this.reject('codec.incomplete', `格式缺少 decode/locate/encode：${codec.docType}`)
      return
    }
    if (this.codecs.has(codec.docType)) {
      this.warn('codec.override', `格式被覆盖：${codec.docType}`)
      const previous = this.codecs.get(codec.docType)!.impl
      for (const [mime, entries] of this.codecsByMime) {
        const kept = entries.filter((entry) => entry.impl !== previous)
        if (kept.length > 0) this.codecsByMime.set(mime, kept)
        else this.codecsByMime.delete(mime)
      }
    }
    const entry = this.entry(codec)
    this.codecs.set(codec.docType, entry)
    for (const mime of codec.mime ?? []) {
      const list = this.codecsByMime.get(mime) ?? []
      list.push(entry)
      this.codecsByMime.set(mime, list)
    }
    this.info('codec.registered', `格式注册：${codec.docType}`)
  }

  registerStore(store: Store): void {
    if (typeof store.query !== 'function') {
      this.reject('store.incomplete', `数据实现缺少 query：${store.docType}`)
      return
    }
    if (this.stores.has(store.docType)) {
      this.warn('store.override', `数据实现被覆盖：${store.docType}`)
    }
    this.stores.set(store.docType, this.entry(store))
    this.info('store.registered', `数据注册：${store.docType}`)
  }

  registerViewAction(action: ViewAction): void {
    if (!action.id || typeof action.run !== 'function') {
      this.reject('action.incomplete', `视图动作缺少 id/run：${String(action.id)}`)
      return
    }
    if (this.actions.has(action.id)) {
      this.warn('action.override', `视图动作被覆盖：${action.id}`)
    }
    this.actions.set(action.id, this.entry(action))
    this.info('action.registered', `视图动作注册：${action.id}`)
  }

  registerCollection(provider: CollectionProvider): void {
    if (!provider.id || typeof provider.list !== 'function') {
      this.reject('collection.incomplete', `集合实现缺少 id/list：${String(provider.id)}`)
      return
    }
    if (this.collections.has(provider.id)) {
      this.warn('collection.override', `集合被覆盖：${provider.id}`)
    }
    this.collections.set(provider.id, this.entry(provider))
    this.info('collection.registered', `集合注册：${provider.id}`)
  }

  registerConsumer(consumer: Consumer): void {
    if (consumer.type !== 'agent' && consumer.type !== 'editor') {
      this.reject('consumer.invalid-type', `出口类型非法：${String(consumer.type)}`)
      return
    }
    if (consumer.type === 'editor' && !consumer.surface) {
      this.reject('consumer.no-surface', `editor 出口缺少 surface：${consumer.docType}`)
      return
    }
    if (!consumer.mime?.length) {
      this.reject('consumer.no-mime', `出口缺少 MIME：${consumer.docType}`)
      return
    }
    const entry = this.entry(consumer)
    const key = consumerKey(consumer.docType, consumer.type)
    const list = this.consumers.get(key) ?? []
    list.push(entry)
    this.consumers.set(key, list)
    for (const mime of consumer.mime) {
      const mimeKey = `${mime}:${consumer.type}`
      const indexed = this.consumersByMime.get(mimeKey) ?? []
      indexed.push(entry)
      this.consumersByMime.set(mimeKey, indexed)
    }
    this.info('consumer.registered', `出口注册：${consumer.docType} · ${consumer.type}`)
  }

  // ─── 查询 ──────────────────────────────────────────────────────

  transportFor(scheme: string): Transport | undefined {
    return this.transports.get(scheme)?.impl
  }

  transportIdOf(scheme: string): TransportId {
    return this.transports.get(scheme)?.impl.id ?? scheme
  }

  // ─── 绑定 ──────────────────────────────────────────────────────

  setBindings(bindings: Binding[]): void {
    this.bindings = [...bindings]
  }

  bindingsSnapshot(): Binding[] {
    return [...this.bindings]
  }

  bindingFor(
    transport: TransportId,
    mime: Mime | undefined,
    intent: Intent,
  ): Binding | undefined {
    return this.bindings
      .filter((binding) => binding.intent === intent)
      .map((binding) => ({ binding, score: bindingScore(binding, transport, mime) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.binding
  }

  codecForMime(
    transport: TransportId,
    mime: Mime | undefined,
    hints: string[],
    docTypeHint?: DocType,
  ): Codec | undefined {
    const explicit = this.bindings
      .filter((binding) => binding.codec)
      .map((binding) => ({ binding, score: bindingScore(binding, transport, mime) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.binding
    if (explicit?.codec) {
      const bound = this.codecs.get(explicit.codec)?.impl
      if (bound) return bound
    }
    if (docTypeHint) {
      const exact = this.codecs.get(docTypeHint)?.impl
      if (exact) return exact
      this.warn('codec.missing-hint', `指定的文档类型未注册：${docTypeHint}`)
      return undefined
    }
    const candidates = mime ? (this.codecsByMime.get(mime) ?? []) : []
    const scoped = candidates.filter(
      (entry) =>
        !entry.impl.transports || entry.impl.transports.includes(transport),
    )
    if (scoped.length > 0) {
      if (scoped.length > 1) {
        this.warn(
          'codec.ambiguous',
          `${mime} 有多个 codec：${scoped.map((e) => e.impl.docType).join(', ')}`,
        )
      }
      return scoped[scoped.length - 1]!.impl
    }
    return this.codecForHints(hints)
  }

  codecForHints(hints: string[], docTypeHint?: DocType): Codec | undefined {
    if (docTypeHint) {
      const exact = this.codecs.get(docTypeHint)
      if (exact) return exact.impl
      this.warn('codec.missing-hint', `指定的文档类型未注册：${docTypeHint}`)
      return undefined
    }
    for (const hint of hints) {
      const matches = [...this.codecs.values()].filter((entry) =>
        entry.impl.hints.includes(hint),
      )
      if (matches.length === 1) return matches[0]!.impl
      if (matches.length > 1) {
        const names = matches.map((m) => m.impl.docType).join(', ')
        this.warn('codec.ambiguous', `格式提示有歧义：${hint} → ${names}`)
        return undefined
      }
    }
    return undefined
  }

  /** 扩展名 → 格式（地图标注用；未知回退 text 兜底格式）。 */
  codecForExtension(ext: string): Codec | undefined {
    const normalized = ext.toLowerCase().replace(/^\./, '')
    for (const entry of this.codecs.values()) {
      if (entry.impl.extensions?.includes(normalized)) return entry.impl
    }
    return this.codecForHints(['text'])
  }

  codecFor(docType: DocType): Codec | undefined {
    return this.codecs.get(docType)?.impl
  }

  viewActions(): Array<{ action: ViewAction; owner: string }> {
    return [...this.actions.values()].map((entry) => ({
      action: entry.impl,
      owner: entry.owner,
    }))
  }

  viewAction(id: string): { action: ViewAction; owner: string } | undefined {
    const entry = this.actions.get(id)
    return entry ? { action: entry.impl, owner: entry.owner } : undefined
  }

  collectionProviders(): Array<{ provider: CollectionProvider; owner: string }> {
    return [...this.collections.values()].map((entry) => ({
      provider: entry.impl,
      owner: entry.owner,
    }))
  }

  storeFor(docType: DocType): Store | undefined {
    return this.stores.get(docType)?.impl
  }

  consumerFor(
    docType: DocType,
    type: Consumer['type'],
    capabilities: readonly string[] = [],
    projection?: string,
    transport?: TransportId,
    mime?: Mime,
  ): Consumer | undefined {
    return this.pickConsumer(
      docType,
      type,
      capabilities,
      projection,
      transport,
      mime,
    )?.impl
  }

  ownerOfConsumer(
    docType: DocType,
    type: Consumer['type'],
    capabilities: readonly string[] = [],
    projection?: string,
    transport?: TransportId,
    mime?: Mime,
  ): string | undefined {
    return this.pickConsumer(
      docType,
      type,
      capabilities,
      projection,
      transport,
      mime,
    )?.owner
  }

  private pickConsumer(
    docType: DocType,
    type: Consumer['type'],
    capabilities: readonly string[],
    projection?: string,
    transport?: TransportId,
    mime?: Mime,
  ): Entry<Consumer> | undefined {
    const indexed = mime
      ? this.consumersByMime.get(`${mime}:${type}`)
      : undefined
    const all = (indexed?.length ? indexed : this.consumers.get(consumerKey(docType, type))) ?? []
    const sameDoc = all.filter((entry) => entry.impl.docType === docType)
    const candidates =
      projection === 'raw'
        ? []
        : projection
          ? sameDoc.filter((entry) => entry.impl.surface === projection)
          : sameDoc
    return candidates
      .filter(
        (entry) =>
          (!transport ||
            !entry.impl.transports ||
            entry.impl.transports.includes(transport)) &&
          (entry.impl.requires ?? []).every((req) =>
            capabilities.includes(req),
          ),
      )
      .sort(
        (a, b) =>
          (b.impl.requires?.length ?? 0) - (a.impl.requires?.length ?? 0) ||
          b.order - a.order,
      )[0]
  }

  /** 数据对象的 schema 清单（模型侧可见）。 */
  schemas(): Array<{ docType: DocType; schema: unknown }> {
    return [...this.stores.values()].map((entry) => ({
      docType: entry.impl.docType,
      schema: entry.impl.schema,
    }))
  }

  // ─── 诊断 / 快照 ───────────────────────────────────────────────

  diagnostics(): readonly Diagnostic[] {
    return this.logs
  }

  diagnosticsFor(level: DiagnosticLevel, code: string, message: string): void {
    this.logs.push({ level, code, message })
  }

  snapshot() {
    return {
      transports: [...this.transports.entries()].map(([scheme, e]) => ({
        scheme,
        owner: e.owner,
      })),
      codecs: [...this.codecs.entries()].map(([docType, e]) => ({
        docType,
        mime: e.impl.mime ?? [],
        hints: e.impl.hints,
        owner: e.owner,
      })),
      stores: [...this.stores.entries()].map(([docType, e]) => ({
        docType,
        owner: e.owner,
      })),
      consumers: [...this.consumers.entries()].flatMap(([key, entries]) =>
        entries.map((e) => ({
          key,
          docType: e.impl.docType,
          type: e.impl.type,
          surface: e.impl.surface,
          mime: e.impl.mime ?? [],
          requires: e.impl.requires ?? [],
          owner: e.owner,
        })),
      ),
      bindings: [...this.bindings],
      collections: [...this.collections.entries()].map(([id, e]) => ({
        id,
        label: e.impl.label,
        owner: e.owner,
      })),
      actions: [...this.actions.entries()].map(([id, e]) => ({
        id,
        label: e.impl.label,
        target: e.impl.target,
        toggle: e.impl.toggle === true,
        owner: e.owner,
      })),
    }
  }

  // ─── 内部 ──────────────────────────────────────────────────────

  private entry<T>(impl: T): Entry<T> {
    return { impl, owner: this.currentOwner(), order: this.order++ }
  }

  private info(code: string, message: string): void {
    this.logs.push({ level: 'info', code, message })
  }

  private warn(code: string, message: string): void {
    this.logs.push({ level: 'warn', code, message })
  }

  private reject(code: string, message: string): void {
    this.logs.push({ level: 'error', code, message })
  }
}

function consumerKey(docType: DocType, type: Consumer['type']): string {
  return `${docType}|${type}`
}

/** 应用级单例：插件入口与宿主共享同一张表。 */
export const uraRegistry = new UraRegistry()

function bindingScore(
  binding: Binding,
  transport: TransportId,
  mime: Mime | undefined,
): number {
  let score = 0
  if (binding.transport === transport) score += 2
  else if (binding.transport !== '*') return -1
  if (mime && binding.mime === mime) score += 2
  else if (binding.mime !== '*') return -1
  return score
}
