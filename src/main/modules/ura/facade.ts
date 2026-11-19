// ─── URA 门面 ────────────────────────────────────────────────────────
//
// 人（页面）、AI（工具）、插件（实现）共用同一组入口：只拿统一标识，不拿路径与句柄。
// 门面只做编排：选来源、选格式、选出口、拼结果；不含格式解释与来源访问。

import type {
  Sidecar,
  TreeItem,
  Caller,
  Presentation,
  ListEntry,
  OpenResult,
  Query,
  ReadOptions,
  WatchHandle,
  Change,
  Binding,
} from '../../../shared/ura.ts';
import { isTextualMime, parseRef } from '../../../shared/ura.ts';
import { sidecarPresentation } from './sidecar.ts';
import { UraError } from './errors.ts';
import { ResourcePipeline, type Opened } from './pipeline.ts';
import { UraRegistry, uraRegistry } from './registry.ts';
import { WriteSession } from './write-session.ts';
import type { BindingStore } from './bindings.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type PageResolver = (surface: string, owner?: string) => string | null;

export interface GrepMatch {
  ref: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  scope?: string;
  ignoreCase?: boolean;
  limit?: number;
}

export interface FindOptions {
  scope?: string;
  limit?: number;
}

const MAX_SCAN_FILES = 500;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

export class Ura {
  constructor(
    private readonly pipeline: ResourcePipeline = new ResourcePipeline(),
    private readonly registry: UraRegistry = uraRegistry,
    private readonly resolvePage: PageResolver = () => null,
    private readonly bindingStore?: BindingStore,
  ) {}

  // ─── 读 ────────────────────────────────────────────────────────

  async read(ref: string, options: ReadOptions = {}): Promise<OpenResult> {
    const opened = await this.pipeline.open(ref);
    const as: Caller = options.as ?? 'agent';
    const presentation =
      as === 'editor'
        ? await this.editorPresentation(opened)
        : await this.textPresentation(opened, options.window);
    return {
      ref,
      version: opened.raw.version,
      codec: opened.codec?.id ?? null,
      degraded: opened.degraded,
      presentation,
    };
  }

  /** 资源当前表现层的归属插件（列表图标等展示元数据用；不打开内容）。 */
  ownerForRef(ref: string): string | undefined {
    const parsed = parseRef(ref);
    const index = parsed.path.lastIndexOf('.');
    const ext = index > 0 ? parsed.path.slice(index + 1).toLowerCase() : '';
    const codec = this.registry.codecForExtension(ext);
    if (!codec || !codec.extensions?.includes(ext)) return undefined;
    const key =
      codec.keys.find(
        (item) => item.transport === '*' || item.transport === parsed.scheme,
      ) ?? codec.keys[0];
    if (!key) return undefined;
    const owner = this.registry.ownerOfPresenter(
      key.transport,
      key.mime,
      codec.id,
    );
    return owner ?? this.registry.ownerOfCodec(codec.id);
  }

  // ─── 绑定 ──────────────────────────────────────────────────────

  bindings(): Binding[] {
    return this.registry.bindingsSnapshot();
  }

  async setBinding(binding: Binding): Promise<Binding[]> {
    const next = this.registry
      .bindingsSnapshot()
      .filter(
        (item) =>
          !(item.transport === binding.transport && item.mime === binding.mime),
      );
    next.push(binding);
    this.registry.setBindings(next);
    await this.bindingStore?.save(next);
    return next;
  }

  async removeBinding(transport: string, mime: string): Promise<Binding[]> {
    const next = this.registry
      .bindingsSnapshot()
      .filter((item) => !(item.transport === transport && item.mime === mime));
    this.registry.setBindings(next);
    await this.bindingStore?.save(next);
    return next;
  }

  // ─── 写 ────────────────────────────────────────────────────────

  /** 原始字节（页面会话冲突基线与二进制调用方使用）。 */
  async readBytes(
    ref: string,
  ): Promise<{ bytes: Uint8Array; version: string }> {
    const opened = await this.pipeline.open(ref);
    return { bytes: opened.raw.bytes, version: opened.raw.version };
  }

  async write(
    ref: string,
    content: string | Uint8Array,
  ): Promise<{ version: string }> {
    return this.pipeline.write(ref, {
      type: 'replace-all',
      bytes: toBytes(content),
    });
  }

  /** 锚定替换（单步写）：定位 → 编码 → 提交。 */
  async edit(
    ref: string,
    anchor: { start: number; end: number; expected?: string },
    content: string | Uint8Array,
  ): Promise<{ version: string }> {
    const opened = await this.pipeline.open(ref);
    if (opened.codec && opened.decoded) {
      const span = opened.codec.locate(opened.decoded, anchor);
      const patch = opened.codec.encode(opened.decoded, {
        type: 'replace-range',
        anchor: { ...anchor, ...span },
        content,
      });
      return this.pipeline.write(ref, patch);
    }
    return this.pipeline.write(ref, {
      type: 'replace-range',
      start: anchor.start,
      end: anchor.end,
      bytes: toBytes(content),
      expected: anchor.expected,
    });
  }

  openWrite(ref: string): Promise<WriteSession> {
    return WriteSession.open(this.pipeline, ref);
  }

  // ─── 清单 / 检索 ───────────────────────────────────────────────

  async ls(ref: string): Promise<ListEntry[]> {
    const transport = this.pipeline.transportFor(ref);
    if (!transport)
      throw new UraError(
        'transport.missing',
        `没有注册来源：${parseRef(ref).scheme}`,
      );
    return transport.list(ref);
  }

  async find(pattern: string, options: FindOptions = {}): Promise<ListEntry[]> {
    const root = options.scope ?? 'file:///';
    const matcher = globToRegExp(pattern);
    const limit = options.limit ?? 200;
    const results: ListEntry[] = [];
    for await (const entry of this.walk(root)) {
      if (entry.type !== 'file') continue;
      const name = entry.ref.slice(entry.ref.lastIndexOf('/') + 1);
      if (!matcher.test(name) && !matcher.test(entry.ref)) continue;
      results.push(entry);
      if (results.length >= limit) break;
    }
    return results;
  }

  async grep(pattern: string, options: GrepOptions = {}): Promise<GrepMatch[]> {
    const root = options.scope ?? 'file:///';
    const regex = new RegExp(pattern, options.ignoreCase ? 'i' : '');
    const limit = options.limit ?? 100;
    const matches: GrepMatch[] = [];
    let scanned = 0;
    let bytes = 0;
    for await (const entry of this.walk(root)) {
      if (entry.type !== 'file') continue;
      if (scanned++ >= MAX_SCAN_FILES || bytes >= MAX_SCAN_BYTES) break;
      let opened: Opened;
      try {
        opened = await this.pipeline.open(entry.ref);
      } catch {
        continue;
      }
      bytes += opened.raw.bytes.length;
      const text = textOf(opened);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i]!)) continue;
        matches.push({ ref: entry.ref, line: i + 1, text: lines[i]! });
        if (matches.length >= limit) return matches;
      }
    }
    return matches;
  }

  async query(ref: string, query: Query): Promise<unknown> {
    const opened = await this.pipeline.open(ref);
    const codec = opened.codec?.id;
    if (!codec) throw new UraError('query.no-document', `资源未解析：${ref}`);
    const store = this.registry.storeFor(
      opened.transportId,
      opened.mime,
      codec,
    );
    if (!store)
      throw new UraError('query.no-store', `格式没有结构化数据：${codec}`);
    return store.query(opened.decoded!, query);
  }

  /** 资源树（渲染层投影；不含内容）。 */
  async tree(ref: string, limit = 2000): Promise<TreeItem[]> {
    const items: TreeItem[] = [];
    for await (const entry of this.walk(ref)) {
      items.push({
        ref: entry.ref,
        name: entry.name,
        type: entry.type,
        ext: entry.type === 'file' ? extensionOf(entry.name) : '',
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      });
      if (items.length >= limit) break;
    }
    return items;
  }

  // ─── 监听 ──────────────────────────────────────────────────────

  watch(
    ref: string,
    listener: (event: import('../../../shared/ura.ts').ChangeEvent) => void,
  ): WatchHandle {
    return this.pipeline.watch(ref, listener);
  }

  // ─── 出口 ──────────────────────────────────────────────────────

  private async textPresentation(
    opened: Opened,
    window?: ReadOptions['window'],
  ): Promise<Sidecar> {
    const provider = opened.codec
      ? this.registry.sidecarFor(
          opened.transportId,
          opened.mime,
          opened.codec.id,
        )
      : undefined;
    if (provider) {
      const sidecar = await provider.sidecar(
        opened.decoded!,
        opened.raw,
        opened.ref,
      );
      return sliceWindow(sidecar, window);
    }
    return sliceWindow(sidecarPresentation(opened), window);
  }

  private async editorPresentation(opened: Opened): Promise<Presentation> {
    const codec = opened.codec?.id ?? '';
    const binding = this.registry.bindingFor(opened.transportId, opened.mime);
    const options = {
      ...(binding?.presenter ? { surface: binding.presenter } : {}),
      capabilities: opened.capabilities,
    };
    const presenter = this.registry.presenterFor(
      opened.transportId,
      opened.mime,
      codec,
      options,
    );
    if (presenter) {
      const presentation = await presenter.present(
        opened.decoded!,
        opened.raw,
        opened.ref,
      );
      if (presentation.type === 'browser') return presentation;
      const owner = this.registry.ownerOfPresenter(
        opened.transportId,
        opened.mime,
        codec,
        options,
      );
      const page = this.resolvePage(presentation.surface, owner);
      return { ...presentation, page: page ?? '', ...(owner ? { owner } : {}) };
    }
    // 无匹配表现层：降级 raw。文本类交给通用文本页（text-editor 的 raw 兜底页），
    // 二进制没有可读投影，保留空页并让视图宿主报「无可用查看器」。
    const textual = !opened.mime || isTextualMime(opened.mime);
    if (textual) {
      return {
        type: 'page',
        surface: 'raw',
        page: this.resolvePage('raw') ?? '',
        data: {
          degraded: true,
          text: decoder.decode(opened.raw.bytes),
          language: 'plaintext',
        },
      };
    }
    return {
      type: 'page',
      surface: 'raw',
      page: '',
      data: { degraded: true, mime: opened.mime },
    };
  }

  // ─── 遍历 ──────────────────────────────────────────────────────

  private async *walk(root: string): AsyncGenerator<ListEntry> {
    const transport = this.pipeline.transportFor(root);
    if (!transport) return;
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: ListEntry[];
      try {
        entries = await transport.list(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        yield entry;
        if (entry.type === 'dir') queue.push(entry.ref);
      }
    }
  }
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

function textOf(opened: Opened): string {
  const mapping = opened.decoded?.anchorMap;
  if (typeof mapping === 'string') return mapping;
  return decoder.decode(opened.raw.bytes);
}

function sliceWindow(
  sidecar: Sidecar,
  window?: ReadOptions['window'],
): Sidecar {
  if (!window) return sidecar;
  const start = Math.max(0, window.start ?? 0);
  const end = window.end ?? sidecar.content.length;
  return { ...sidecar, content: sidecar.content.slice(start, end) };
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export type { Change };
