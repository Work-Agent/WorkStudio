// ─── URA 契约面（shared） ────────────────────────────────────────────
//
// 资源身份、注册载荷、读写结果。这里只有类型与纯函数：
// 主进程实现管道，渲染层只消费结果类型（页面入口 + 数据）。

export type Caller = 'agent' | 'editor' | 'system'

/** 文档类型：名称 @ 版本。 */
export type DocType = `${string}@${number}`


// ─── 格式身份（MIME / Content-Type） ────────────────────────────────

/** 内置 MIME：标准 Content-Type 的 `type/subtype`。 */
export const MIME = {
  text: 'text/plain',
  markdown: 'text/markdown',
  html: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  octetStream: 'application/octet-stream',
} as const

export type BuiltinMime = (typeof MIME)[keyof typeof MIME]

/** 可扩展：内置字面量 + 任意标准 `type/subtype`（含 vendor 类型）。 */
export type Mime = BuiltinMime | `${string}/${string}`

/** 常见别名 → 规范值。 */
export const MIME_ALIASES: Record<string, BuiltinMime> = {
  'text/x-markdown': MIME.markdown,
  'application/x-markdown': MIME.markdown,
  'text/xml': MIME.xml,
  'application/x-yaml': MIME.yaml,
  'text/yaml': MIME.yaml,
  'image/jpg': MIME.jpeg,
  'application/x-pdf': MIME.pdf,
}

/** 扩展名（不含点，小写）→ MIME。 */
export const MIME_EXTENSIONS: Record<string, Mime> = {
  txt: MIME.text,
  log: MIME.text,
  ini: MIME.text,
  conf: MIME.text,
  md: MIME.markdown,
  markdown: MIME.markdown,
  html: MIME.html,
  htm: MIME.html,
  json: MIME.json,
  xml: MIME.xml,
  yaml: MIME.yaml,
  yml: MIME.yaml,
  csv: MIME.csv,
  tsv: MIME.tsv,
  pdf: MIME.pdf,
  docx: MIME.docx,
  docm: MIME.docx,
  dotx: MIME.docx,
  xlsx: MIME.xlsx,
  xlsm: MIME.xlsx,
  xltx: MIME.xlsx,
  pptx: MIME.pptx,
  pptm: MIME.pptx,
  potx: MIME.pptx,
  png: MIME.png,
  jpg: MIME.jpeg,
  jpeg: MIME.jpeg,
  gif: MIME.gif,
  webp: MIME.webp,
  svg: MIME.svg,
}

export interface ParsedContentType {
  mime: Mime
  /** charset 等参数；不参与格式匹配。 */
  params: Record<string, string>
}

/** 解析 Content-Type；只比较 `type/subtype`，参数单独保留。 */
export function parseContentType(value?: string | null): ParsedContentType {
  if (!value) return { mime: MIME.octetStream, params: {} }
  const [rawType, ...rawParams] = value.split(';')
  const type = (rawType ?? '').trim().toLowerCase()
  const mime: Mime = /^[^\s/]+\/[^\s/]+$/.test(type)
    ? (MIME_ALIASES[type] ?? (type as Mime))
    : MIME.octetStream
  const params: Record<string, string> = {}
  for (const raw of rawParams) {
    const index = raw.indexOf('=')
    if (index < 0) continue
    const key = raw.slice(0, index).trim().toLowerCase()
    const valueText = raw
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, '')
    if (key) params[key] = valueText
  }
  return { mime, params }
}

export function mimeFromExtension(ext: string): Mime | undefined {
  return MIME_EXTENSIONS[ext.replace(/^\./, '').toLowerCase()]
}

// ─── 来源类型（可扩展） ──────────────────────────────────────────────

export const TRANSPORT_IDS = [
  'file',
  'http',
  'https',
  'webdav',
  'sftp',
] as const

export type BuiltinTransportId = (typeof TRANSPORT_IDS)[number]

/** 可扩展：内置 id + 插件自定义来源 id。 */
export type TransportId = BuiltinTransportId | (string & {})

export type TransportCapability =
  | 'read'
  | 'write'
  | 'list'
  | 'watch'
  | 'live'

export interface TransportDescriptor {
  id: TransportId
  schemes: readonly string[]
  capabilities: readonly TransportCapability[]
}

export const BUILTIN_TRANSPORTS: readonly TransportDescriptor[] = [
  {
    id: 'file',
    schemes: ['file'],
    capabilities: ['read', 'write', 'list', 'watch'],
  },
  { id: 'http', schemes: ['http'], capabilities: ['read', 'live'] },
  { id: 'https', schemes: ['https'], capabilities: ['read', 'live'] },
]
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
  mime?: Mime
}

export interface ListEntry {
  name: string
  ref: string
  type: ResourceType
  size?: number
  version?: string
}

export type TransportWriteOptions = Record<string, never>

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
  /** 来源类型（绑定键）；缺省时用 scheme。 */
  readonly id?: TransportId
  readonly scheme: string
  /** 来源能力：read / write / list / watch / live。 */
  readonly capabilities?: readonly TransportCapability[]
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
  /** 锚点映射：供 locate 反查锚点。 */
  anchorMap: unknown
  outline?: unknown
}

export interface Span {
  start: number
  end: number
}

export interface Codec {
  /** 可解析的规范 MIME（Content-Type 的 type/subtype）。 */
  readonly mime: readonly Mime[]
  /** 限定来源类型；缺省 = 通用。 */
  readonly transports?: readonly TransportId[]
  /** 格式提示（按具体度声明，不含兜底 text；MIME 缺失时用）。 */
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

export interface Sidecar {
  type: 'text'
  content: string
  truncated?: boolean
}

export interface PagePresentation {
  type: 'page'
  surface: string
  /** 渲染器归属插件（页面与动作的作用域）。 */
  owner?: string
  /** 页面入口（由插件清单解析；raw 降级时为空）。 */
  page: string
  data: unknown
  actions?: string[]
}

/** 浏览器表现层：由视图宿主加载 URL（Browser 即一种 Presenter）。 */
export interface Browser {
  type: 'browser'
  surface: string
  url: string
}

export type Presentation = PagePresentation | Browser

/** 表现层实现：只负责“用户看到什么”。 */
export interface Presenter {
  readonly docType: DocType
  readonly mime: readonly Mime[]
  readonly transports?: readonly TransportId[]
  readonly type: 'page' | 'browser'
  readonly requires?: string[]
  readonly surface?: string
  present(
    decoded: DecodedDoc,
    raw: RawContent,
    ref: string,
  ): Promise<Presentation> | Presentation
}

/** agent 读取面：只负责“agent 读到什么”。 */
export interface SidecarProvider {
  readonly docType: DocType
  readonly mime: readonly Mime[]
  readonly transports?: readonly TransportId[]
  sidecar(
    decoded: DecodedDoc,
    raw: RawContent,
    ref: string,
  ): Promise<Sidecar> | Sidecar
}

// ─── 绑定（transport × MIME → 实现） ─────────────────────────────────

export type Intent = 'render' | 'edit' | 'query' | 'agent'

export interface Binding {
  /** 来源类型 id，'*' = 任意。 */
  transport: string
  /** 规范 MIME，'*' = 任意。 */
  mime: string
  intent: Intent
  /** 指定 codec 的 docType。 */
  codec?: DocType
  /** 指定表现层：'browser' / 'raw' / presenter surface。 */
  presenter?: string
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

export type Registration =
  | TransportRegistration
  | CodecRegistration
  | StoreRegistration

// ─── 门面结果 ────────────────────────────────────────────────────────

export interface OpenResult {
  ref: string
  version: string
  docType: DocType | null
  formatHints: string[]
  /** 没有匹配的格式实现时降级 raw。 */
  degraded: boolean
  presentation: Presentation | Sidecar
}

export interface ReadOptions {
  as?: Caller
  docTypeHint?: DocType
  window?: { start?: number; end?: number }
}

export type CommitResult = { ok: true; version: string }

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
