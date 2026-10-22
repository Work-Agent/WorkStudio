// ─── URA 契约面（shared） ────────────────────────────────────────────
//
// 资源身份、注册载荷、读写结果。这里只有类型与纯函数：
// 主进程实现管道，渲染层只消费结果类型（页面入口 + 数据）。

export type Caller = 'agent' | 'editor' | 'system'

/** 文档类型：名称 @ 版本。 */
export type DocType = `${string}@${number}`

export type PatchKind = 'text' | 'bytes'

// ─── 资源身份 ────────────────────────────────────────────────────────

/** 统一标识：scheme://authority/path。物理路径、连接、句柄不出域。 */
export interface ResourceRef {
  scheme: string
  authority: string
  path: string
}

const REF_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i

export function formatRef(ref: ResourceRef): string {
  const path = ref.path.startsWith('/') ? ref.path : `/${ref.path}`
  return `${ref.scheme}://${ref.authority}${path}`
}

export function parseRef(id: string): ResourceRef {
  const match = REF_PATTERN.exec(id)
  if (!match) throw new Error(`invalid resource id: ${id}`)
  return {
    scheme: match[1]!.toLowerCase(),
    authority: match[2] ?? '',
    path: match[3] ?? '/',
  }
}

export function schemeOf(id: string): string {
  return parseRef(id).scheme
}

// ─── 来源（transport） ───────────────────────────────────────────────

export type ResourceType = 'file' | 'dir' | 'other'

export interface ResourceStat {
  version: string
  type: ResourceType
  size: number
  mtimeMs?: number
}

/** 来源读出的原始内容 + 格式提示 + 版本。提示有序：越具体越靠前。 */
export interface RawContent extends ResourceStat {
  bytes: Uint8Array
  formatHints: string[]
  mime?: string
}

export interface ListEntry {
  name: string
  ref: string
  type: ResourceType
  size?: number
  version?: string
}

export interface TransportWriteOptions {
  /** 严格模式下的期望版本；不匹配即冲突。 */
  expectedVersion?: string
}

export interface TransportWriteResult {
  version: string
}

export type ChangeType = 'content' | 'structure' | 'state'

export interface ChangeEvent {
  ref: string
  type: ChangeType
  version?: string
  at: number
}

export interface Transport {
  readonly scheme: string
  /** 来源能力：read / write / list / watch / live。 */
  readonly capabilities?: string[]
  stat(ref: string): Promise<ResourceStat>
  read(ref: string): Promise<RawContent>
  write(
    ref: string,
    patch: Patch,
    opts: TransportWriteOptions,
  ): Promise<TransportWriteResult>
  list(ref: string): Promise<ListEntry[]>
  watch?(ref: string, emit: (event: ChangeEvent) => void): () => void
}

// ─── 传输层补丁 ──────────────────────────────────────────────────────

export type Patch =
  | { type: 'replace-all'; bytes: Uint8Array }
  | {
      type: 'replace-range'
      start: number
      end: number
      bytes: Uint8Array
      /** 严格模式下基线片段必须匹配。 */
      expected?: string
    }

export type Anchor = { start: number; end: number; expected?: string }

export type Change =
  | { type: 'replace-all'; content: string | Uint8Array }
  | { type: 'replace-range'; anchor: Anchor; content: string | Uint8Array }

// ─── 格式（codec） ───────────────────────────────────────────────────

export interface DecodedDoc {
  docType: DocType
  /** 结构化文档（插件自定义）。 */
  doc: unknown
  /** 投影映射：供 locate 反查锚点。 */
  projection: unknown
  outline?: unknown
}

export interface Span {
  start: number
  end: number
}

export interface Codec {
  /** 格式提示（按具体度声明，不含兜底 text）。 */
  readonly hints: string[]
  /** 扩展名（不含点；用于资源地图的格式标注）。 */
  readonly extensions?: string[]
  readonly docType: DocType
  readonly patchType: PatchKind
  decode(raw: RawContent, ref: string): Promise<DecodedDoc> | DecodedDoc
  /** 用投影映射把锚点反查成结构化文档中的跨度。 */
  locate(decoded: DecodedDoc, anchor: Anchor): Span
  /** 结构化变更 → 传输层可消费的补丁。 */
  encode(decoded: DecodedDoc, change: Change): Patch
}

// ─── 数据（store） ───────────────────────────────────────────────────

export interface Query {
  select?: string[]
  where?: Record<string, unknown>
  limit?: number
}

export interface Store {
  readonly docType: DocType
  /** 只读 schema（模型侧可见）。 */
  readonly schema: unknown
  query(decoded: DecodedDoc, query: Query): Promise<unknown> | unknown
}

// ─── 出口（consumer） ────────────────────────────────────────────────

export interface AgentProjection {
  type: 'text'
  content: string
  truncated?: boolean
}

export interface PageProjection {
  type: 'page'
  surface: string
  /** 渲染器归属插件（页面与动作的作用域）。 */
  owner?: string
  /** 页面入口（由插件清单解析；raw 降级时为空）。 */
  page: string
  data: unknown
  actions?: string[]
}

/** 实时视图投影：由视图宿主加载 URL（浏览器运行时）。 */
export interface BrowserProjection {
  type: 'browser'
  surface: string
  url: string
}

export type EditorProjection = PageProjection | BrowserProjection

export type Projection = AgentProjection | EditorProjection

export interface Consumer {
  readonly docType: DocType
  readonly type: 'agent' | 'editor'
  /** 需要 transport 具备的能力（如 live）；缺省 = 通用。 */
  readonly requires?: string[]
  /** editor 出口的页面标识（页面由插件清单解析）。 */
  readonly surface?: string
  project(
    decoded: DecodedDoc,
    raw: RawContent,
    ref: string,
  ): Promise<Projection> | Projection
}

// ─── 视图动作（地址栏工具条贡献） ────────────────────────────────────

export interface ViewActionContext {
  viewId: string
  type: 'browser' | 'extension'
  /** 本次切换后的状态（toggle 动作）。 */
  on: boolean
  /** 回报动作状态（壳层据此高亮 / 换图标）。 */
  setState(state: string): void
  /** 在页面里执行脚本（仅 browser 目标提供）。 */
  execute<T = unknown>(script: string): Promise<T>
}

export interface ViewAction {
  readonly id: string
  readonly label: string
  /** 图标语义名（壳层映射；未知回退通用图标）。 */
  readonly icon?: string
  /**
   * 适用作用域：'browser' | 'any' | 渲染器 id | 插件 id | 文档类型。
   * 地址栏按钮随激活视图的渲染器过滤。
   */
  readonly target: string
  readonly toggle?: boolean
  run(ctx: ViewActionContext): Promise<void> | void
}

export interface ViewActionView {
  id: string
  label: string
  icon?: string
  toggle: boolean
  active: boolean
}

// ─── 集合（侧栏分组贡献） ────────────────────────────────────────────

export interface CollectionItem {
  ref: string
  title: string
}

export interface CollectionGroup {
  id: string
  title: string
  /** 分组图标：URL（favicon）或空（由 provider 图标兜底）。 */
  icon?: string
  order?: number
  items: CollectionItem[]
}

export interface CollectionContext {
  /** 工作区根（file:// 标识）。 */
  workspace: string
  /** 资源发现（不持句柄，只用统一标识）。 */
  tree(ref: string, limit?: number): Promise<TreeItem[]>
  find(pattern: string, options?: { scope?: string; limit?: number }): Promise<ListEntry[]>
  settings: {
    get<T>(key: string, fallback: T): Promise<T>
  }
}

export interface CollectionView {
  source: string
  owner: string
  label: string
  icon?: string
  groups: CollectionGroup[]
}

export interface CollectionProvider {
  /** 集合 id（也是侧栏 source id）。 */
  readonly id: string
  readonly label: string
  /** provider 级图标（分组未给 icon 时使用）。 */
  readonly icon?: string
  list(ctx: CollectionContext): CollectionGroup[] | Promise<CollectionGroup[]>
}

// ─── 注册载荷 ────────────────────────────────────────────────────────

export interface TransportRegistration {
  transport: Transport
}

export interface CodecRegistration {
  codec: Codec
}

export interface StoreRegistration {
  store: Store
}

export interface ConsumerRegistration {
  consumer: Consumer
}

export type Registration =
  | TransportRegistration
  | CodecRegistration
  | StoreRegistration
  | ConsumerRegistration

// ─── 门面结果 ────────────────────────────────────────────────────────

export interface OpenResult {
  ref: string
  version: string
  docType: DocType | null
  formatHints: string[]
  /** 没有匹配的格式实现时降级 raw。 */
  degraded: boolean
  projection: Projection
}

export interface ReadOptions {
  as?: Caller
  docTypeHint?: DocType
  window?: { start?: number; end?: number }
}

export interface WriteConflict {
  /** 文本内容，或二进制内容的 base64（见 encoding）。 */
  base: string
  current: string
  mine: string
  encoding?: 'text' | 'base64'
}

export type CommitResult =
  | { ok: true; version: string }
  | { ok: false; conflict: WriteConflict }

/** 资源树条目（渲染层投影用；不含内容）。 */
export interface TreeItem {
  ref: string
  name: string
  type: ResourceType
  ext: string
  size?: number
}

export interface WatchHandle {
  readonly ref: string
  close(): void
}
