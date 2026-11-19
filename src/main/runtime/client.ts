/**
 * client 组件：renderer 侧的 bridge 类型声明。
 *
 * 不包含运行时包装；renderer 直接使用 window.workStudio。
 */

import type { CallResult, DomainUpdate } from './shared.ts';

export interface WorkStudioBridge {
  /** 订阅 (domain, resource)，返回该 resource 的 snapshot。 */
  subscribe(domain: string, resource: string): Promise<unknown>;
  /** 取消 (domain, resource) 订阅。 */
  unsubscribe(domain: string, resource: string): void;
  /** 向 (domain, resource, action) 发有回复命令。 */
  command<T = unknown>(
    domain: string,
    resource: string,
    action: string,
    input?: unknown,
  ): Promise<CallResult<T>>;
  /** 向 (domain, resource, action) 发无回复命令。 */
  notify(
    domain: string,
    resource: string,
    action: string,
    value?: unknown,
  ): void;
  onUpdate(listener: (update: DomainUpdate) => void): () => void;
}

declare global {
  interface Window {
    workStudio: WorkStudioBridge;
  }
}
