/**
 * EventBridge —— session 事件 → 线格式 → 合帧 → ws:event（architecture.md §6）。
 *
 * 线格式：pi 事件直接结构化克隆回渲染层，唯一瘦身点是 message_update 的累积快照
 * （partial / message）：delta-only 后帧体积恒定，避免平方放大。
 * 合帧：16ms 冲刷窗口；可合并事件（message_update / tool_execution_update /
 * bash_execution_update）窗口内只保留最新帧；定序事件不合并。
 * 序号：每帧单调递增 seq；渲染层检测缺口 → ws:sync 快照重建。
 */
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  AppInternalEvent,
  PiEventFrame,
  PiSessionEvent,
} from '../../shared/types';

const FLUSH_INTERVAL_MS = 16;

function mergeKey(event: { type: string }): string | null {
  switch (event.type) {
    case 'message_update':
      return 'message_update';
    case 'tool_execution_update':
      return `tool_execution_update:${(event as { toolCallId?: string }).toolCallId ?? ''}`;
    case 'bash_execution_update':
      return 'bash_execution_update';
    default:
      return null;
  }
}

/** message_update 累积快照剥离（toJsonEvent 的等价最小实现）。 */
function toWireEvent(event: AgentSessionEvent): PiSessionEvent {
  if (event.type === 'message_update') {
    const raw = event.assistantMessageEvent as Record<string, unknown> & {
      type?: string;
    };
    const { partial: _partial, message: _message, ...rest } = raw;
    return {
      type: 'message_update',
      usage: (event as { usage?: unknown }).usage,
      assistantMessageEvent: rest,
    } as unknown as PiSessionEvent;
  }
  return event as unknown as PiSessionEvent;
}

export class EventBridge {
  private queue: PiEventFrame[] = [];
  private mergeSlots = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly send: (frame: PiEventFrame) => void) {}

  attach(session: AgentSession): void {
    this.detach();
    this.unsubscribe = session.subscribe((event) => {
      this.push(toWireEvent(event));
    });
  }

  detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** 应用内部事件族（与 pi 事件共用序列）。 */
  pushInternal(event: AppInternalEvent): void {
    this.push(event as unknown as PiSessionEvent);
  }

  get currentSeq(): number {
    return this.seq;
  }

  private push(event: PiSessionEvent): void {
    const key = mergeKey(event);
    if (key !== null) {
      const existing = this.mergeSlots.get(key);
      if (existing !== undefined) {
        this.queue[existing] = { seq: this.queue[existing].seq, event };
        this.scheduleFlush();
        return;
      }
      this.mergeSlots.set(key, this.queue.length);
    }
    this.queue.push({ seq: ++this.seq, event });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const frames = this.queue;
    this.queue = [];
    this.mergeSlots.clear();
    for (const frame of frames) this.send(frame);
  }

  dispose(): void {
    this.detach();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
