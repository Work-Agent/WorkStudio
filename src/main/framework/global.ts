/** 全局注册面：直接使用根路径；与资源服务共用一棵路径树。 */

import type { StateHandle } from '../core/handles';
import { normalize } from '../core/paths';
import type { Owner } from '../core/table';
import type { RouteCall } from '../core/types';
import type { GlobalRegistration } from './middleware';
import type { Host } from './host';

const APP: Owner = { type: 'app' };

export class AppGlobal implements GlobalRegistration {
  constructor(private readonly host: Host) {}

  handle<I, O>(
    path: string,
    handler: (call: RouteCall<I>) => O | Promise<O>,
  ): void {
    this.host.registerCommand(
      normalize(path),
      '/',
      APP,
      (call) => handler(call as RouteCall<I>) as O | Promise<O>,
    );
  }

  state<T>(path: string): StateHandle<T> {
    return this.host.registerState<T>(normalize(path), '/', APP);
  }

  inbound(path: string, handler: (call: RouteCall) => void): void {
    this.host.registerInbound(normalize(path), handler);
  }
}

export { APP as GLOBAL_OWNER };
