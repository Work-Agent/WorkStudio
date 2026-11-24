/**
 * Dispatcher：唯一入口。
 *
 * 判定来源 → 解析地址 → 调用命令表 / 绑定订阅 → 记录日志。
 * 不承载业务逻辑，不解释 locator，也不注入工具。
 */

import type { CallResult, DomainUpdate, Origin } from '../contract.ts';
import { exitCodeOf, failure } from '../contract.ts';
import { createLog } from '../log.ts';
import { parseAddress } from '../registry/address.ts';
import type { CommandContext, CommandInput } from '../registry/command.ts';
import type { DomainRegistry } from '../registry/registry.ts';
import type { Origins } from './origins.ts';

export interface DispatcherOptions {
  log?: boolean;
  /** 把更新投递给对应视图（由 Electron 组合根绑定 webContents.send）。 */
  sendUpdate(viewId: string, update: DomainUpdate): void;
}

type Operation = 'call' | 'send' | 'watch' | 'unwatch';

interface RequestLogEntry {
  op: Operation;
  origin: string;
  address: string;
  action: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'missing';
  exitCode?: number;
  error?: string;
}

export class Dispatcher {
  private readonly senders = new Map<string, string>();
  private readonly log = createLog('ipc');

  constructor(
    private readonly registry: DomainRegistry,
    private readonly origins: Origins,
    private readonly options: DispatcherOptions,
  ) {
    registry.onUpdate((update) => this.deliver(update));
  }

  call(
    senderId: string,
    addr: string,
    action: string,
    input: unknown,
  ): Promise<CallResult> {
    return this.dispatch(senderId, addr, action, input, 'call');
  }

  /** 单向通知：失败只记日志，不返回给页面。 */
  send(senderId: string, addr: string, action: string, value: unknown): void {
    void this.dispatch(senderId, addr, action, value, 'send').then((result) => {
      if (!result.ok)
        this.log.warn(`${addr}/${action}：${result.error.message}`);
    });
  }

  /** 绑定订阅并返回首次快照；后续 patch / event 由 deliver 推送。 */
  watch(senderId: string, addr: string): CallResult<unknown> {
    const started = Date.now();
    const viewId = this.viewIdOf(senderId);
    const address = parseAddress(addr);
    if (!viewId) {
      this.write('watch', senderId, addr, '', started, 'missing', '未知来源');
      return failure('invalid', '未知来源');
    }
    if (!address) {
      this.write('watch', senderId, addr, '', started, 'missing', '地址非法');
      return failure('invalid', `地址非法：${addr}`);
    }
    const target = this.registry.resolve(address);
    if (!target) {
      this.write('watch', senderId, addr, '', started, 'missing', '地址不存在');
      return failure('unknown', `地址不存在：${addr}`);
    }

    this.senders.set(viewId, senderId);
    const snapshot = target.resource.subscribe(viewId);
    this.write('watch', senderId, addr, '', started, 'ok');
    return { ok: true, data: snapshot };
  }

  unwatch(senderId: string, addr: string): void {
    const started = Date.now();
    const viewId = this.viewIdOf(senderId);
    const address = parseAddress(addr);
    if (!viewId || !address) {
      this.write('unwatch', senderId, addr, '', started, 'missing');
      return;
    }
    this.registry.unsubscribe(viewId, address);
    this.write('unwatch', senderId, addr, '', started, 'ok');
  }

  /** 视图销毁：一次性撤销它的全部订阅与投递映射。 */
  releaseView(viewId: string): void {
    this.registry.unsubscribeView(viewId);
    this.senders.delete(viewId);
  }

  private async dispatch(
    senderId: string,
    addr: string,
    action: string,
    input: unknown,
    op: Operation,
  ): Promise<CallResult> {
    const started = Date.now();
    const origin = this.origins.of(senderId);
    const address = parseAddress(addr);
    if (!origin) {
      this.write(op, senderId, addr, action, started, 'missing', '未知来源');
      return failure('invalid', '未知来源');
    }
    if (!address) {
      this.write(op, senderId, addr, action, started, 'missing', '地址非法');
      return failure('invalid', `地址非法：${addr}`);
    }
    if (
      input !== undefined &&
      (typeof input !== 'object' || input === null || Array.isArray(input))
    ) {
      this.write(op, senderId, addr, action, started, 'missing', '入参非法');
      return failure('invalid', '入参必须是对象');
    }

    const ctx: CommandContext = {
      origin,
      changed: (ref, type) => this.registry.changed(ref, type),
      log: createLog(`${address.domain}/${action}`),
    };
    const result = await this.registry.dispatchCommand(
      address,
      action,
      (input ?? {}) as CommandInput,
      ctx,
    );

    if (result.ok) {
      this.write(op, senderId, addr, action, started, 'ok');
    } else {
      this.write(
        op,
        senderId,
        addr,
        action,
        started,
        'error',
        result.error.message,
        exitCodeOf(result.error.code),
      );
    }
    return result;
  }

  private deliver(update: DomainUpdate): void {
    for (const viewId of this.registry.subscribersOf({
      domain: update.domain,
      resource: update.resource,
    })) {
      if (this.senders.has(viewId)) {
        this.options.sendUpdate(viewId, update);
      }
    }
  }

  private viewIdOf(senderId: string): string | null {
    const origin = this.origins.of(senderId);
    return origin?.type === 'view' ? origin.viewId : null;
  }

  private write(
    op: Operation,
    senderId: string,
    address: string,
    action: string,
    started: number,
    outcome: RequestLogEntry['outcome'],
    error?: string,
    exitCode?: number,
  ): void {
    if (!this.options.log) return;
    const origin = this.origins.of(senderId);
    const entry: RequestLogEntry = {
      op,
      origin: origin ? originLabel(origin) : 'unknown',
      address,
      action,
      durationMs: Date.now() - started,
      outcome,
      ...(error ? { error } : {}),
      ...(exitCode === undefined ? {} : { exitCode }),
    };
    console.log('[ipc]', entry);
  }
}

function originLabel(origin: Origin): string {
  switch (origin.type) {
    case 'view':
      return `view:${origin.viewType}:${origin.viewId}`;
    case 'service':
      return `service:${origin.id}`;
    case 'tool':
      return `tool:${origin.name}`;
  }
}
