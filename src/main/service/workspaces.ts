/**
 * 工作区业务：注册表 + 当前工作区。
 * 状态与操作在类上；路径绑定在 routes.ts。
 */

import type { WorkspaceMeta } from '../../shared/app';
import { WorkspacesRepo, type WorkspacesStore } from '../repo/workspaces';

export class WorkspacesService {
  beforeChange: (() => Promise<boolean>) | null = null;
  private listView: WorkspaceMeta[] = [];
  private currentView: WorkspaceMeta | null = null;
  private readonly changeListeners = new Set<() => void>();
  private readonly closeListeners = new Set<(id: string) => void>();
  private readonly openListeners = new Set<
    (meta: WorkspaceMeta) => void | Promise<void>
  >();

  private readonly store: WorkspacesStore = new WorkspacesRepo();

  /** 恢复上次工作区（首次启动创建默认工作区）。 */
  restore(): WorkspaceMeta {
    return this.store.restore();
  }

  get list(): WorkspaceMeta[] {
    return this.listView;
  }

  get current(): WorkspaceMeta | null {
    return this.currentView;
  }

  refresh(): WorkspaceMeta[] {
    this.listView = this.store.list();
    this.emitChange();
    return this.listView;
  }

  /** 默认工作区回落提示（用户目录不可写时非空）。 */
  get notice(): string | null {
    return this.store.notice;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onClose(listener: (id: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onOpen(listener: (meta: WorkspaceMeta) => void | Promise<void>): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  start(): void {
    this.listView = this.store.list();
    const id = this.store.readCurrent();
    this.currentView = id
      ? (this.listView.find((item) => item.id === id) ?? null)
      : null;
    this.emitChange();
  }

  async open(path: string): Promise<WorkspaceMeta> {
    if (!path) throw new Error('workspace path is required');
    if (this.currentView?.path === path) return this.currentView;
    if (this.beforeChange && !(await this.beforeChange()) && this.currentView)
      return this.currentView;
    const next = this.store.register(path);
    const prev = this.currentView;
    if (prev && prev.id !== next.id) this.emitClose(prev.id);
    this.store.writeCurrent(next.id);
    this.currentView = next;
    this.listView = this.store.list();
    this.emitChange();
    for (const listener of this.openListeners) await listener(next);
    return next;
  }

  async close(): Promise<boolean> {
    const prev = this.currentView;
    if (!prev) return true;
    if (this.beforeChange && !(await this.beforeChange())) return false;
    this.emitClose(prev.id);
    this.store.writeCurrent(null);
    this.currentView = null;
    this.emitChange();
    return true;
  }

  rename(id: string, name: string): WorkspaceMeta {
    const meta = this.store.rename(id, name);
    if (!meta) throw new Error(`unknown workspace ${id}`);
    this.listView = this.store.list();
    if (this.currentView?.id === meta.id) this.currentView = meta;
    this.emitChange();
    return meta;
  }

  async remove(id: string): Promise<void> {
    if (this.currentView?.id === id && !(await this.close())) return;
    this.store.remove(id);
    this.listView = this.store.list();
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  private emitClose(id: string): void {
    for (const listener of this.closeListeners) listener(id);
  }
}
