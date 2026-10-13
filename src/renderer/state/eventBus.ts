/**
 * 应用内事件总线 —— 模块间通讯通道（渲染层内部解耦）。
 * 主进程事件仍经 IPC 进来，再由模块转译为总线事件。
 */

/** 跨模块事件词汇表。 */
export type AppEvent =
  | { type: 'resource:opened'; docId: string; instanceId: string }
  | { type: 'resource:closed'; docId: string | null; instanceId: string }
  | { type: 'instance:ready'; instanceId: string }
  | { type: 'instance:contentDelivered'; instanceId: string }
  | { type: 'session:streaming'; path: string }
  | { type: 'session:done'; path: string }
  | { type: 'session:error'; path: string; message: string };

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();

export const eventBus = {
  /** 发布事件（同步分发）。 */
  emit(event: AppEvent): void {
    for (const listener of listeners) listener(event);
  },
  /** 订阅（返回退订函数）。 */
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
