/**
 * 资源业务（URA 门面 + 页面会话）。
 * 读写 / 检索 / 监听 / 页面会话；路径绑定在 routes.ts。
 */

import type {
  ChangeEvent,
  CommitResult,
  ListEntry,
  Query,
  ReadOptions,
  TreeItem,
} from '../../../shared/ura.ts';
import type {
  FindOptions,
  GrepMatch,
  GrepOptions,
  Ura,
} from '../ura/facade.ts';
import { UraError } from '../ura/errors.ts';
import type { PageSessionInfo, PageSessions } from '../ura/page-sessions.ts';

export interface ResourcesDeps {
  ura: Ura;
  pages: PageSessions;
  isDirty?: (pageId: string) => boolean;
}

export type OpenPageResult =
  | { type: 'browser'; url: string }
  | { type: 'page'; info: PageSessionInfo };

export class ResourcesService {
  private readonly pagesView = new Map<string, PageSessionInfo>();
  private readonly watchers = new Map<string, { close(): void }>();
  private readonly pageListeners = new Set<() => void>();
  private readonly reloadListeners = new Set<(info: PageSessionInfo) => void>();
  private readonly missingPages = new Set<string>();
  private readonly missingListeners = new Set<
    (pageId: string, missing: boolean) => void
  >();
  private readonly changeListeners = new Set<
    (ref: string, change: ChangeEvent) => void
  >();

  constructor(private readonly deps: ResourcesDeps) {}

  read(ref: string, options?: ReadOptions): Promise<unknown> {
    return this.deps.ura.read(ref, options);
  }

  write(
    ref: string,
    content: string | Uint8Array,
  ): Promise<{ version: string }> {
    return this.deps.ura.write(ref, content);
  }

  edit(
    ref: string,
    anchor: { start: number; end: number; expected?: string },
    content: string | Uint8Array,
  ): Promise<{ version: string }> {
    return this.deps.ura.edit(ref, anchor, content);
  }

  ls(ref: string): Promise<ListEntry[]> {
    return this.deps.ura.ls(ref);
  }

  find(pattern: string, options?: FindOptions): Promise<ListEntry[]> {
    return this.deps.ura.find(pattern, options);
  }

  grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]> {
    return this.deps.ura.grep(pattern, options);
  }

  query(ref: string, query: Query): Promise<unknown> {
    return this.deps.ura.query(ref, query);
  }

  tree(ref: string, limit?: number): Promise<TreeItem[]> {
    return this.deps.ura.tree(ref, limit);
  }

  watch(ref: string): void {
    this.watchers.get(ref)?.close();
    const handle = this.deps.ura.watch(ref, (change) => {
      for (const listener of this.changeListeners) listener(ref, change);
    });
    this.watchers.set(ref, handle);
  }

  unwatch(ref: string): void {
    this.watchers.get(ref)?.close();
    this.watchers.delete(ref);
  }

  onResourceChange(
    listener: (ref: string, change: ChangeEvent) => void,
  ): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  async openPage(ref: string): Promise<OpenPageResult> {
    const target = await this.deps.pages.open(ref);
    if (target.type === 'browser') return target;
    const info = target.info;
    this.pagesView.set(info.id, info);
    this.setMissing(info.id, false);
    this.watch(info.ref);
    this.emitPageChange();
    return { type: 'page', info };
  }

  async savePage(
    pageId: string,
    content: string | Uint8Array,
  ): Promise<CommitResult> {
    const result = await this.deps.pages.save(pageId, content);
    this.pagesView.set(pageId, this.deps.pages.get(pageId));
    this.setMissing(pageId, false);
    this.emitPageChange();
    return result;
  }

  async reloadPage(pageId: string, external = false): Promise<PageSessionInfo> {
    if (external && this.deps.isDirty?.(pageId)) {
      const info = this.deps.pages.get(pageId);
      this.emitPageReload(info);
      return info;
    }
    try {
      const info = await this.deps.pages.reload(pageId);
      this.pagesView.set(pageId, info);
      this.setMissing(pageId, false);
      this.emitPageChange();
      this.emitPageReload(info);
      return info;
    } catch (error) {
      if (error instanceof UraError && error.code === 'resource.not-found') {
        this.setMissing(pageId, true);
      }
      throw error;
    }
  }

  closePage(pageId: string): void {
    const info = this.pagesView.get(pageId);
    this.deps.pages.close(pageId);
    this.pagesView.delete(pageId);
    this.missingPages.delete(pageId);
    if (info) this.unwatch(info.ref);
    this.emitPageChange();
  }

  /** 页面快照的视图投递格式；随会话数据实时更新。 */
  pageContent(pageId: string): unknown {
    const info = this.pagesView.get(pageId);
    if (!info) return undefined;
    return {
      meta: { id: info.ref },
      content:
        typeof info.data === 'object' && info.data !== null
          ? String((info.data as { text?: unknown }).text ?? '')
          : '',
    };
  }

  page(pageId: string): PageSessionInfo | undefined {
    return this.pagesView.get(pageId);
  }

  pages(): PageSessionInfo[] {
    return [...this.pagesView.values()];
  }

  onPagesChange(listener: () => void): () => void {
    this.pageListeners.add(listener);
    return () => this.pageListeners.delete(listener);
  }

  /** 会话数据重建后通知宿主投递。 */
  onPageReloaded(listener: (info: PageSessionInfo) => void): () => void {
    this.reloadListeners.add(listener);
    return () => {
      this.reloadListeners.delete(listener);
    };
  }

  /** 文件缺失状态（删除/重命名）变化。 */
  onPageMissing(
    listener: (pageId: string, missing: boolean) => void,
  ): () => void {
    this.missingListeners.add(listener);
    return () => {
      this.missingListeners.delete(listener);
    };
  }

  /** 工作区换代：关闭资源页面与监听。 */
  reset(): void {
    for (const id of this.pagesView.keys()) this.closePage(id);
    for (const handle of this.watchers.values()) handle.close();
    this.watchers.clear();
    this.missingPages.clear();
  }

  dispose(): void {
    this.reset();
  }

  private emitPageChange(): void {
    for (const listener of this.pageListeners) listener();
  }

  private emitPageReload(info: PageSessionInfo): void {
    for (const listener of this.reloadListeners) listener(info);
  }

  private setMissing(pageId: string, missing: boolean): void {
    if (this.missingPages.has(pageId) === missing) return;
    if (missing) this.missingPages.add(pageId);
    else this.missingPages.delete(pageId);
    for (const listener of this.missingListeners) listener(pageId, missing);
  }
}
