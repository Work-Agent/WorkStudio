/**
 * 视图注册表：身份、授权、订阅、投递。
 *
 * 每个视图一条记录；出站帧先按订阅集合过滤，再交给该视图的 sink。
 * 原生身份（webContents ↔ viewId）由 IPC 适配层接入时再补。
 */

import { matchPattern, substituteSelf } from '../core/paths';
import type { Frame, Grant, Origin, ViewType } from '../core/types';

export type ViewSink = (frame: Frame) => void;

export interface ViewRecord {
  id: string;
  type: ViewType;
  title: string;
  url: string;
  grants: Grant;
  subscriptions: Set<string>;
  state: 'loading' | 'ready' | 'crashed';
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  /** 文件已删除或重命名。 */
  missing: boolean;
  /** 脏视图期间外部内容已变化。 */
  conflict: boolean;
  sessionId: string | null;
  contentPath: string | null;
  externalId: string | null;
}

export interface ViewSnapshot {
  id: string;
  tabKey: string;
  type: ViewType;
  title: string;
  url: string;
  contentPath: string | null;
  state: 'loading' | 'ready' | 'crashed';
  active: boolean;
  pinned: boolean;
  dirty: boolean;
  missing: boolean;
  conflict: boolean;
}

export interface CreateViewInput {
  type: ViewType;
  title?: string;
  url?: string;
  grants?: Grant;
  sessionId?: string | null;
  contentPath?: string | null;
  externalId?: string | null;
  id?: string;
}

export class ViewRegistry {
  private readonly records = new Map<string, ViewRecord>();
  private readonly sinks = new Map<string, ViewSink>();
  private readonly external = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private counter = 0;

  create(input: CreateViewInput): ViewRecord {
    const id = input.id ?? `${input.type}-${(this.counter += 1)}`;
    if (this.records.has(id)) throw new Error(`view ${id} already exists`);
    const record: ViewRecord = {
      id,
      type: input.type,
      title: input.title ?? input.type,
      url: input.url ?? '',
      grants: input.grants ?? {},
      subscriptions: new Set(),
      state: 'loading',
      active: false,
      pinned: false,
      dirty: false,
      missing: false,
      conflict: false,
      sessionId: input.sessionId ?? null,
      contentPath: input.contentPath ?? null,
      externalId: input.externalId ?? null,
    };
    this.records.set(id, record);
    if (record.externalId) this.external.set(record.externalId, id);
    this.notify();
    return record;
  }

  get(id: string): ViewRecord | null {
    return this.records.get(id) ?? null;
  }

  findByContentPath(path: string): ViewRecord | null {
    for (const record of this.records.values()) {
      if (record.contentPath === path) return record;
    }
    return null;
  }

  findBySessionId(sessionId: string): ViewRecord | null {
    for (const record of this.records.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return null;
  }

  /** 内容视图（标签集合）；系统视图不在其中。 */
  list(): ViewSnapshot[] {
    return [...this.records.values()]
      .filter((record) => record.type === 'page' || record.type === 'web')
      .map(snapshotOf);
  }

  replacePage(
    id: string,
    input: { contentPath: string; title: string; url: string; grants: Grant },
  ): void {
    const record = this.records.get(id);
    if (!record) return;
    Object.assign(record, input, {
      state: 'loading',
      dirty: false,
      conflict: false,
      missing: false,
    });
    record.subscriptions.clear();
    this.notify();
  }

  bind(id: string, externalId: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.externalId = externalId;
    this.external.set(externalId, id);
  }

  originOf(externalId: string): Origin | null {
    const id = this.external.get(externalId);
    if (!id) return null;
    const record = this.records.get(id);
    if (!record) return null;
    return {
      type: 'view',
      viewId: record.id,
      viewType: record.type,
      path: record.contentPath,
    };
  }

  attach(id: string, sink: ViewSink): void {
    this.sinks.set(id, sink);
  }

  /** 授权：视图的 grants 只放路径模式；默认拒绝。 */
  authorize(id: string, op: 'call' | 'watch', path: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    const patterns = op === 'call' ? record.grants.call : record.grants.watch;
    return Boolean(
      patterns?.some((pattern) =>
        matchPattern(substituteSelf(pattern, id), path),
      ),
    );
  }

  watch(id: string, paths: string[]): void {
    const record = this.records.get(id);
    if (!record) return;
    for (const path of paths) record.subscriptions.add(path);
  }

  /** 广播帧：只交给订阅了该路径的视图。 */
  deliver(frame: Frame): void {
    for (const record of this.records.values()) {
      if (!record.subscriptions.has(frame.path)) continue;
      this.sinks.get(record.id)?.(frame);
    }
  }

  deliverTo(id: string, frame: Frame): void {
    this.sinks.get(id)?.(frame);
  }

  setActive(id: string): void {
    for (const record of this.records.values()) record.active = false;
    const target = this.records.get(id);
    if (target) target.active = true;
    this.notify();
  }

  activeId(): string | null {
    for (const record of this.records.values()) {
      if (record.active) return record.id;
    }
    return null;
  }

  setState(id: string, state: ViewRecord['state']): void {
    const record = this.records.get(id);
    if (!record || record.state === state) return;
    record.state = state;
    this.notify();
  }

  setDirty(id: string, dirty: boolean): void {
    const record = this.records.get(id);
    if (!record) return;
    const clearConflict = !dirty && record.conflict;
    if (record.dirty === dirty && !clearConflict) return;
    record.dirty = dirty;
    if (!dirty) record.conflict = false;
    this.notify();
  }

  setMissing(id: string, missing: boolean): void {
    const record = this.records.get(id);
    if (!record || record.missing === missing) return;
    record.missing = missing;
    this.notify();
  }

  setConflict(id: string, conflict: boolean): void {
    const record = this.records.get(id);
    if (!record || record.conflict === conflict) return;
    record.conflict = conflict;
    this.notify();
  }

  togglePin(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.pinned = !record.pinned;
    this.notify();
  }

  /** 把 fromId 移到 toId 之前；顺序即标签顺序。 */
  move(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const entries = [...this.records.entries()];
    const from = entries.findIndex(([id]) => id === fromId);
    const to = entries.findIndex(([id]) => id === toId);
    if (from === -1 || to === -1) return;
    const [entry] = entries.splice(from, 1);
    const target = entries.findIndex(([id]) => id === toId);
    entries.splice(target === -1 ? entries.length : target, 0, entry);
    this.records.clear();
    for (const [id, record] of entries) this.records.set(id, record);
    this.notify();
  }

  remove(id: string): ViewRecord | null {
    const record = this.records.get(id) ?? null;
    if (!record) return null;
    this.records.delete(id);
    this.sinks.delete(id);
    if (record.externalId) this.external.delete(record.externalId);
    this.notify();
    return record;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.records.clear();
    this.sinks.clear();
    this.external.clear();
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function snapshotOf(record: ViewRecord): ViewSnapshot {
  return {
    id: record.id,
    tabKey: record.contentPath ?? record.id,
    type: record.type,
    title: record.title,
    url: record.url,
    contentPath: record.contentPath,
    state: record.state,
    active: record.active,
    pinned: record.pinned,
    dirty: record.dirty,
    missing: record.missing,
    conflict: record.conflict,
  };
}
