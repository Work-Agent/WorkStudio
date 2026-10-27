// ─── URA 注册表 ──────────────────────────────────────────────────────
//
// 两级键：codec 认 (transport, mime)；store / presenter / sidecar 认
// (transport, mime, codec)。注册是同步的、纯登记的；冲突按后注册者胜出
// 并进诊断，不做静默合并。

import type {
  Binding,
  Codec,
  Mime,
  OutletKey,
  Presenter,
  SidecarProvider,
  Store,
  Transport,
  TransportId,
  ViewAction,
} from '../../shared/ura';

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
}

interface Entry<T> {
  impl: T;
  owner: string;
  order: number;
}

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/i;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;

export class UraRegistry {
  private readonly transports = new Map<string, Entry<Transport>>();
  private readonly codecs = new Map<string, Entry<Codec>>();
  private readonly codecList: Entry<Codec>[] = [];
  private readonly stores: Entry<Store>[] = [];
  private readonly presenters: Entry<Presenter>[] = [];
  private readonly sidecars: Entry<SidecarProvider>[] = [];
  private readonly actions = new Map<string, Entry<ViewAction>>();
  private bindings: Binding[] = [];
  private readonly logs: Diagnostic[] = [];
  private owner: string | null = null;
  private order = 0;

  // ─── 归属上下文 ────────────────────────────────────────────────
  // 插件入口在模块求值时注册；宿主在 import 期间置入归属，注册项据此记名。

  async runAs<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.owner;
    this.owner = owner;
    try {
      return await fn();
    } finally {
      this.owner = previous;
    }
  }

  currentOwner(): string {
    return this.owner ?? 'unknown';
  }

  // ─── 来源 ──────────────────────────────────────────────────────

  registerTransport(transport: Transport): void {
    const scheme = transport.scheme;
    if (!SCHEME_PATTERN.test(scheme)) {
      this.reject('transport.invalid-scheme', `来源协议非法：${scheme}`);
      return;
    }
    if (
      typeof transport.stat !== 'function' ||
      typeof transport.read !== 'function' ||
      typeof transport.write !== 'function' ||
      typeof transport.list !== 'function'
    ) {
      this.reject(
        'transport.incomplete',
        `来源缺少 stat/read/write/list：${scheme}`,
      );
      return;
    }
    if (this.transports.has(scheme)) {
      this.warn('transport.override', `来源被覆盖：${scheme}`);
    }
    this.transports.set(scheme, this.entry(transport));
    this.info('transport.registered', `来源注册：${scheme}`);
  }

  transportFor(scheme: string): Transport | undefined {
    return this.transports.get(scheme)?.impl;
  }

  transportIdOf(scheme: string): TransportId {
    return this.transports.get(scheme)?.impl.id ?? scheme;
  }

  // ─── 格式 ──────────────────────────────────────────────────────

  registerCodec(codec: Codec): void {
    if (!ID_PATTERN.test(codec.id)) {
      this.reject('codec.invalid-id', `格式标识非法：${codec.id}`);
      return;
    }
    if (!codec.keys?.length) {
      this.reject('codec.no-key', `格式缺少 (transport, mime) 键：${codec.id}`);
      return;
    }
    if (codec.keys.some((key) => !key.mime || !key.transport)) {
      this.reject('codec.invalid-key', `格式键不完整：${codec.id}`);
      return;
    }
    if (codec.patchType !== 'text' && codec.patchType !== 'bytes') {
      this.reject('codec.invalid-patch-type', `补丁形态非法：${codec.id}`);
      return;
    }
    if (
      typeof codec.decode !== 'function' ||
      typeof codec.locate !== 'function' ||
      typeof codec.encode !== 'function'
    ) {
      this.reject(
        'codec.incomplete',
        `格式缺少 decode/locate/encode：${codec.id}`,
      );
      return;
    }
    if (this.codecs.has(codec.id)) {
      this.warn('codec.override', `格式被覆盖：${codec.id}`);
      const previous = this.codecs.get(codec.id)!.impl;
      const index = this.codecList.findIndex(
        (entry) => entry.impl === previous,
      );
      if (index >= 0) this.codecList.splice(index, 1);
    }
    const entry = this.entry(codec);
    this.codecs.set(codec.id, entry);
    this.codecList.push(entry);
    this.info('codec.registered', `格式注册：${codec.id}`);
  }

  /** 按 (transport, mime) 找 codec；用户绑定里的 codec 优先。 */
  codecFor(transport: TransportId, mime: Mime | undefined): Codec | undefined {
    const bound = this.boundCodec(transport, mime);
    if (bound) return bound;
    if (!mime) return undefined;
    const scored = this.codecList
      .map((entry) => ({
        entry,
        score: codecScore(entry.impl, transport, mime),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || b.entry.order - a.entry.order);
    if (scored.length > 1 && scored[0]!.score === scored[1]!.score) {
      this.warn(
        'codec.ambiguous',
        `${transport} + ${mime} 有多个 codec：${scored
          .filter((item) => item.score === scored[0]!.score)
          .map((item) => item.entry.impl.id)
          .join(', ')}`,
      );
    }
    return scored[0]?.entry.impl;
  }

  codecById(id: string): Codec | undefined {
    return this.codecs.get(id)?.impl;
  }

  /** 扩展名 → 格式（地图标注用；未知回退 text/plain）。 */
  codecForExtension(ext: string): Codec | undefined {
    const normalized = ext.toLowerCase().replace(/^\./, '');
    for (const entry of this.codecList) {
      if (entry.impl.extensions?.includes(normalized)) return entry.impl;
    }
    return this.codecFor('*', 'text/plain');
  }

  // ─── 数据 ──────────────────────────────────────────────────────

  registerStore(store: Store): void {
    if (typeof store.query !== 'function') {
      this.reject(
        'store.incomplete',
        `数据实现缺少 query：${keyOf(store.key)}`,
      );
      return;
    }
    if (!validKey(store.key)) {
      this.reject('store.invalid-key', `数据键不完整：${keyOf(store.key)}`);
      return;
    }
    if (this.stores.some((entry) => sameKey(entry.impl.key, store.key))) {
      this.warn('store.override', `数据实现被覆盖：${keyOf(store.key)}`);
    }
    this.stores.push(this.entry(store));
    this.info('store.registered', `数据注册：${keyOf(store.key)}`);
  }

  storeFor(
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
  ): Store | undefined {
    return this.pick(this.stores, transport, mime, codec)?.impl;
  }

  // ─── 出口 ──────────────────────────────────────────────────────

  registerPresenter(presenter: Presenter): void {
    if (presenter.type !== 'page' && presenter.type !== 'browser') {
      this.reject(
        'presenter.invalid-type',
        `表现层类型非法：${String(presenter.type)}`,
      );
      return;
    }
    if (!presenter.surface) {
      this.reject(
        'presenter.no-surface',
        `表现层缺少 surface：${keyOf(presenter.key)}`,
      );
      return;
    }
    if (typeof presenter.present !== 'function') {
      this.reject(
        'presenter.incomplete',
        `表现层缺少 present：${keyOf(presenter.key)}`,
      );
      return;
    }
    if (!validKey(presenter.key)) {
      this.reject(
        'presenter.invalid-key',
        `表现层键不完整：${keyOf(presenter.key)}`,
      );
      return;
    }
    this.presenters.push(this.entry(presenter));
    this.info(
      'presenter.registered',
      `表现层注册：${keyOf(presenter.key)} · ${presenter.surface}`,
    );
  }

  presenterFor(
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
    options: { surface?: string; capabilities?: readonly string[] } = {},
  ): Presenter | undefined {
    return this.pickPresenter(transport, mime, codec, options)?.impl;
  }

  ownerOfPresenter(
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
    options: { surface?: string; capabilities?: readonly string[] } = {},
  ): string | undefined {
    return this.pickPresenter(transport, mime, codec, options)?.owner;
  }

  registerSidecar(provider: SidecarProvider): void {
    if (typeof provider.sidecar !== 'function') {
      this.reject(
        'sidecar.incomplete',
        `sidecar 缺少 sidecar()：${keyOf(provider.key)}`,
      );
      return;
    }
    if (!validKey(provider.key)) {
      this.reject(
        'sidecar.invalid-key',
        `sidecar 键不完整：${keyOf(provider.key)}`,
      );
      return;
    }
    this.sidecars.push(this.entry(provider));
    this.info('sidecar.registered', `sidecar 注册：${keyOf(provider.key)}`);
  }

  sidecarFor(
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
  ): SidecarProvider | undefined {
    return this.pick(this.sidecars, transport, mime, codec)?.impl;
  }

  /** 数据对象的 schema 清单（模型侧可见）。 */
  schemas(): Array<{ codec: string; schema: unknown }> {
    return this.stores.map((entry) => ({
      codec: entry.impl.key.codec,
      schema: entry.impl.schema,
    }));
  }

  // ─── 集合 / 动作 ───────────────────────────────────────────────

  registerViewAction(action: ViewAction): void {
    if (!action.id || typeof action.run !== 'function') {
      this.reject(
        'action.incomplete',
        `视图动作缺少 id/run：${String(action.id)}`,
      );
      return;
    }
    if (this.actions.has(action.id)) {
      this.warn('action.override', `视图动作被覆盖：${action.id}`);
    }
    this.actions.set(action.id, this.entry(action));
    this.info('action.registered', `视图动作注册：${action.id}`);
  }

  viewActions(): Array<{ action: ViewAction; owner: string }> {
    return [...this.actions.values()].map((entry) => ({
      action: entry.impl,
      owner: entry.owner,
    }));
  }

  viewAction(id: string): { action: ViewAction; owner: string } | undefined {
    const entry = this.actions.get(id);
    return entry ? { action: entry.impl, owner: entry.owner } : undefined;
  }

  // ─── 绑定 ──────────────────────────────────────────────────────

  setBindings(bindings: Binding[]): void {
    this.bindings = [...bindings];
  }

  bindingsSnapshot(): Binding[] {
    return [...this.bindings];
  }

  /** (transport, mime) → 用户绑定；presenter 为空时用默认解析。 */
  bindingFor(
    transport: TransportId,
    mime: Mime | undefined,
  ): Binding | undefined {
    return this.bindings
      .map((binding) => ({
        binding,
        score: bindingScore(binding, transport, mime),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.binding;
  }

  // ─── 诊断 / 快照 ───────────────────────────────────────────────

  diagnostics(): readonly Diagnostic[] {
    return this.logs;
  }

  diagnosticsFor(level: DiagnosticLevel, code: string, message: string): void {
    this.logs.push({ level, code, message });
  }

  snapshot() {
    return {
      transports: [...this.transports.entries()].map(([scheme, entry]) => ({
        scheme,
        id: entry.impl.id ?? scheme,
        owner: entry.owner,
      })),
      codecs: [...this.codecs.values()].map((entry) => ({
        id: entry.impl.id,
        keys: entry.impl.keys,
        extensions: entry.impl.extensions ?? [],
        owner: entry.owner,
      })),
      stores: this.stores.map((entry) => ({
        key: entry.impl.key,
        owner: entry.owner,
      })),
      presenters: this.presenters.map((entry) => ({
        key: entry.impl.key,
        type: entry.impl.type,
        surface: entry.impl.surface,
        requires: entry.impl.requires ?? [],
        owner: entry.owner,
      })),
      sidecars: this.sidecars.map((entry) => ({
        key: entry.impl.key,
        owner: entry.owner,
      })),
      bindings: [...this.bindings],
      actions: [...this.actions.entries()].map(([id, entry]) => ({
        id,
        label: entry.impl.label,
        target: entry.impl.target,
        toggle: entry.impl.toggle === true,
        owner: entry.owner,
      })),
    };
  }

  // ─── 内部 ──────────────────────────────────────────────────────

  private boundCodec(
    transport: TransportId,
    mime: Mime | undefined,
  ): Codec | undefined {
    const binding = this.bindingFor(transport, mime);
    if (!binding?.codec) return undefined;
    const codec = this.codecs.get(binding.codec)?.impl;
    if (!codec) {
      this.warn(
        'codec.missing-binding',
        `绑定的 codec 未注册：${binding.codec}`,
      );
      return undefined;
    }
    return codec;
  }

  private pick<T>(
    list: Entry<T>[],
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
  ): Entry<T> | undefined {
    return this.scored(list, transport, mime, codec)[0];
  }

  private pickPresenter(
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
    options: { surface?: string; capabilities?: readonly string[] },
  ): Entry<Presenter> | undefined {
    if (options.surface === 'raw') return undefined;
    const capabilities = options.capabilities ?? [];
    const candidates = this.presenters
      .map((entry) => ({
        entry,
        score: keyScore(entry.impl.key, transport, mime, codec),
      }))
      .filter(
        (item) =>
          item.score >= 0 &&
          (!options.surface || item.entry.impl.surface === options.surface) &&
          (item.entry.impl.requires ?? []).every((req) =>
            capabilities.includes(req),
          ),
      )
      .sort(
        (a, b) =>
          (b.entry.impl.requires?.length ?? 0) -
            (a.entry.impl.requires?.length ?? 0) ||
          b.score - a.score ||
          b.entry.order - a.entry.order,
      );
    return candidates[0]?.entry;
  }

  private scored<T>(
    list: Entry<T>[],
    transport: TransportId,
    mime: Mime | undefined,
    codec: string,
  ): Entry<T>[] {
    return list
      .map((entry) => ({
        entry,
        score: keyScore(
          (entry.impl as { key: OutletKey }).key,
          transport,
          mime,
          codec,
        ),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || b.entry.order - a.entry.order)
      .map((item) => item.entry);
  }

  private entry<T>(impl: T): Entry<T> {
    return { impl, owner: this.currentOwner(), order: this.order++ };
  }

  private info(code: string, message: string): void {
    this.logs.push({ level: 'info', code, message });
  }

  private warn(code: string, message: string): void {
    this.logs.push({ level: 'warn', code, message });
  }

  private reject(code: string, message: string): void {
    this.logs.push({ level: 'error', code, message });
  }
}

/** 应用级单例：插件入口与宿主共享同一张表。 */
export const uraRegistry = new UraRegistry();

function keyOf(key: OutletKey): string {
  return `${key.transport}|${key.mime}|${key.codec || '-'}`;
}

function sameKey(a: OutletKey, b: OutletKey): boolean {
  return (
    a.transport === b.transport && a.mime === b.mime && a.codec === b.codec
  );
}

function validKey(key: OutletKey): boolean {
  return (
    Boolean(key) &&
    Boolean(key.transport) &&
    Boolean(key.mime) &&
    key.codec !== undefined
  );
}

function codecScore(codec: Codec, transport: TransportId, mime: Mime): number {
  let best = -1;
  for (const key of codec.keys) {
    if (key.mime !== mime) continue;
    const score =
      key.transport === transport ? 2 : key.transport === '*' ? 0 : -1;
    if (score > best) best = score;
  }
  return best;
}

function keyScore(
  key: OutletKey,
  transport: TransportId,
  mime: Mime | undefined,
  codec: string,
): number {
  if (key.codec !== codec) return -1;
  let score = 0;
  if (key.transport === transport) score += 2;
  else if (key.transport !== '*') return -1;
  if (mime && key.mime === mime) score += 2;
  else if (key.mime !== '*') return -1;
  return score;
}

function bindingScore(
  binding: Binding,
  transport: TransportId,
  mime: Mime | undefined,
): number {
  let score = 0;
  if (binding.transport === transport) score += 2;
  else if (binding.transport !== '*') return -1;
  if (mime && binding.mime === mime) score += 2;
  else if (binding.mime !== '*') return -1;
  return score;
}
