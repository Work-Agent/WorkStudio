/**
 * 插件动态实现：激活后由 ESM 入口导出。
 *
 * 静态与动态的分界只有一条：不执行代码就能知道的进清单，
 * 必须跑起来才有的进这里。
 */

import type { CommandDecl } from './command.ts';
import type { PluginContext } from './context.ts';
import type { ResourceAdapter } from './resource.ts';

export type PluginCommandInput = { ref: string } & Record<string, unknown>;

export interface PluginCommand extends CommandDecl {
  run(input: PluginCommandInput, ctx: PluginContext): Promise<unknown>;
}

export interface PluginLifecycle {
  activate?(): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface PluginContribution {
  /** 资源适配器：键是域内资源名，也是 ref 路由的落点。 */
  resources: Record<string, ResourceAdapter>;
  /** 命令键 `<domain>.<action>`；插件不解析 argv。 */
  commands: Record<string, PluginCommand>;
  lifecycle?: PluginLifecycle;
}

/** 插件入口的登记函数：只返回描述，不执行任何副作用。 */
export function definePlugin(
  contribution: PluginContribution,
): PluginContribution {
  return contribution;
}
