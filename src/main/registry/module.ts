/**
 * 模块 = 生命周期 + 依赖；Domain = 服务边界。
 *
 * 模块在 attach 期间声明自己持有的服务与资源；DomainRegistry 统一
 * 登记、按依赖启停，并按归属撤销（插件热卸载）。
 */

import type { DomainRegistry } from './registry.ts';

export interface DomainModule {
  readonly id: string;
  /** 启动依赖（模块 id）；拓扑序 start，反向 stop。 */
  readonly dependencies?: readonly string[];
  /** 声明本模块持有的 System / Biz Domain 及其资源。 */
  attach(registry: DomainRegistry): void;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
