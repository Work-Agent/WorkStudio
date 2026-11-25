/**
 * 插件动态实现：激活后由 ESM 入口导出。
 *
 * 静态与动态的分界只有一条：不执行代码就能知道的进清单，
 * 必须跑起来才有的进这里。
 */

import type { CommandDecl } from './command.ts';
import type { PluginContext } from './context.ts';
import type { PluginList } from './list.ts';
import type { ResourceAdapter } from './resource.ts';
import type { PluginScope } from './scope.ts';

export type PluginCommandInput = { ref: string } & Record<string, unknown>;

/** 命令的调用面控制；助手默认看不到插件命令。 */
export interface PluginCommandExposure {
  /** 是否暴露给助手命令表；缺省 false。 */
  agent?: boolean;
}

export interface PluginCommand extends CommandDecl {
  run(input: PluginCommandInput, ctx: PluginContext): Promise<unknown>;
  expose?: PluginCommandExposure;
}

export interface PluginLifecycle {
  /** 激活：创建跨命令的运行时；scope 在 deactivate 后失效。 */
  activate?(scope: PluginScope): void | Promise<void>;
  deactivate?(scope: PluginScope): void | Promise<void>;
}

export interface PluginContribution {
  /** 资源适配器：键是域内资源名，也是 ref 路由的落点。 */
  resources: Record<string, ResourceAdapter>;
  /** 命令键 `<domain>.<action>`；插件不解析 argv。 */
  commands: Record<string, PluginCommand>;
  /** 插件列表：定义 + 现取数据；owner 由宿主编排。 */
  lists?: readonly PluginList[];
  /** 是否创建 `<pluginId>/events` 事件资源。 */
  events?: boolean;
  lifecycle?: PluginLifecycle;
}

/** 插件入口的登记函数：只返回描述，不执行任何副作用。 */
export function definePlugin(
  contribution: PluginContribution,
): PluginContribution {
  return contribution;
}
