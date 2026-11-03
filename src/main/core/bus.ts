/**
 * 总线：状态保留 + 事件广播 + 帧合并。
 *
 *   publish(path, value)  状态：宿主缓存最近值
 *   emit(path, value)     事件：不缓存，按路径自增序号
 *
 * 投递是批量的：同一帧内的发布与事件按首次出现顺序合并成一组帧。
 * 状态的重复发布只保留最新值，但位置保留第一次出现的位置。
 */

import { within } from './paths';
import type { EventFrame, Frame, StateFrame } from './types';

export interface RetainedState<T = unknown> {
  value: T;
}

export type FrameListener = (frame: Frame) => void;

type Pending =
  | { type: 'state'; path: string }
  | { type: 'event'; frame: EventFrame };

export class Bus {
  private readonly retained = new Map<string, RetainedState>();
  private readonly seqs = new Map<string, number>();
  private readonly listeners = new Set<FrameListener>();
  private pending: Pending[] = [];
  private scheduled = false;
  private disposed = false;

  publish<T>(path: string, value: T): void {
    if (this.disposed) return;
    this.retained.set(path, { value });
    this.pending.push({ type: 'state', path });
    this.schedule();
  }

  emit<T>(path: string, value: T): void {
    if (this.disposed) return;
    const seq = (this.seqs.get(path) ?? 0) + 1;
    this.seqs.set(path, seq);
    this.pending.push({
      type: 'event',
      frame: { type: 'event', path, seq, at: Date.now(), value },
    });
    this.schedule();
  }

  /** 最近一次状态值（没有则 null）。 */
  read<T>(path: string): T | null {
    const state = this.retained.get(path);
    return state ? (state.value as T) : null;
  }

  /** 最近一次状态，用于订阅回放。 */
  state<T>(path: string): RetainedState<T> | null {
    return (this.retained.get(path) as RetainedState<T>) ?? null;
  }

  /** 键清理：删除该路径及其子树下的保留值与待发帧。 */
  drop(path: string): void {
    for (const key of Array.from(this.retained.keys())) {
      if (within(path, key)) this.retained.delete(key);
    }
    this.pending = this.pending.filter((item) =>
      item.type === 'state'
        ? !within(path, item.path)
        : !within(path, item.frame.path),
    );
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 立即冲刷（测试 / 退出前）。 */
  flush(): void {
    this.flushNow();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.pending = [];
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flushNow();
    });
  }

  private flushNow(): void {
    if (this.disposed || this.pending.length === 0) return;

    const pending = this.pending.splice(0);
    const seenStates = new Set<string>();
    const frames: Frame[] = [];

    for (const item of pending) {
      if (item.type === 'event') {
        frames.push(item.frame);
        continue;
      }
      if (seenStates.has(item.path)) continue;
      seenStates.add(item.path);
      const state = this.retained.get(item.path);
      if (!state) continue;
      frames.push({
        type: 'state',
        path: item.path,
        value: state.value,
      } satisfies StateFrame);
    }

    for (const frame of frames) {
      for (const listener of Array.from(this.listeners)) listener(frame);
    }

    if (this.pending.length > 0) this.schedule();
  }
}
