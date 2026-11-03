/**
 * 工作区业务：注册表 + 当前工作区。
 * 状态与操作在类上；路径绑定在 routes.ts。
 */

import type { WorkspaceMeta } from '../../shared/app';
import { WorkspacesRepo, type WorkspacesStore } from '../repo/workspaces';

export class WorkspacesService {
  private listView: WorkspaceMeta[] = [];
  private currentView: WorkspaceMeta | null = null;
  private readonly changeListeners = new Set<() => void>();
  private readonly closeListeners = new Set<(id: string) => void>();
  private readonly openListeners = new Set<
    (meta: WorkspaceMeta) => void | Promise<void>
  >();

  private readonly store: WorkspacesStore;

  constructor(documentsDir: string) {
    this.store = new WorkspacesRepo(documentsDir);
  }

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

  close(): void {
    const prev = this.currentView;
    if (!prev) return;
    this.emitClose(prev.id);
    this.store.writeCurrent(null);
    this.currentView = null;
    this.emitChange();
  }

  rename(id: string, name: string): WorkspaceMeta {
    const meta = this.store.rename(id, name);
    if (!meta) throw new Error(`unknown workspace ${id}`);
    this.listView = this.store.list();
    if (this.currentView?.id === meta.id) this.currentView = meta;
    this.emitChange();
    return meta;
  }

  remove(id: string): void {
    if (this.currentView?.id === id) this.close();
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
