/**
 * 通用有限状态机内核 —— docs/architecture.md §13.3。
 *
 *   - 转换表显式（`"from:event": "to"`）：非法组合 = 表里没有 = 拒绝 + warn
 *   - 状态为普通值（响应性由消费方 store 镜像承接：onEnter 里同步镜像）
 *   - onEnter 副作用挂在转换上（如 RELOAD 内清内容投递记录——结构上不可能忘）
 */

export interface Machine<S extends string, E extends string> {
  /** 当前状态。 */
  state: () => S;
  /** 派发事件；非法转换拒绝并 warn，返回 false。 */
  send: (event: E, payload?: unknown) => boolean;
  /** 当前状态下该事件是否可派发。 */
  can: (event: E) => boolean;
  /** 是否处于任一给定状态（便捷断言）。 */
  is: (...states: S[]) => boolean;
}

export interface MachineConfig<S extends string, _E extends string> {
  id: string;
  initial: S;
  /** 显式转换表：键 "from:event"，值为目标状态。 */
  transitions: Record<string, S>;
  /** 进入某状态的副作用（转换触发，非首次 mount）。 */
  onEnter?: Partial<Record<S, (from: S, payload?: unknown) => void>>;
  /** 调试：非法转换是否抛错（默认 warn）。 */
  strict?: boolean;
}

const key = (from: string, event: string): string => `${from}:${event}`;

export function createMachine<S extends string, E extends string>(
  cfg: MachineConfig<S, E>,
): Machine<S, E> {
  let current: S = cfg.initial;

  const send = (event: E, payload?: unknown): boolean => {
    const from = current;
    const next = cfg.transitions[key(from, event as string)];
    if (next === undefined) {
      const msg = `[fsm:${cfg.id}] 拒绝 ${from} --${event}-->（无该转换）`;
      if (cfg.strict) throw new Error(msg);
      console.warn(msg);
      return false;
    }
    current = next;
    cfg.onEnter?.[next]?.(from, payload);
    return true;
  };

  return {
    state: () => current,
    send,
    can: (event) =>
      cfg.transitions[key(current, event as string)] !== undefined,
    is: (...states) => states.includes(current),
  };
}
