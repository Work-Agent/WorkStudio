/**
 * 插件六阶段：install → resolve → activate → ready → deactivate → uninstall。
 *
 * 装载失败只影响该插件：已登记的贡献被撤销，其它插件继续。
 */

import type { PluginContribution } from '@workstudio/sdk';
import type { Protocols } from '../protocols.ts';
import type { PluginManager } from './manager.ts';
import type { PluginPackage } from './manifest.ts';

export type PluginStage =
  | 'install'
  | 'resolve'
  | 'activate'
  | 'ready'
  | 'deactivate'
  | 'uninstall';

export class PluginLifecycle {
  private readonly stages = new Map<string, PluginStage>();

  constructor(
    private readonly manager: PluginManager,
    private readonly protocols: Protocols,
  ) {}

  async install(pkg: PluginPackage): Promise<void> {
    this.stages.set(pkg.manifest.id, 'install');
  }

  /** 校验清单身份与内容页；失败则拒绝装载。 */
  async resolve(pkg: PluginPackage): Promise<void> {
    const { manifest } = pkg;
    if (!manifest.id) {
      throw new Error('插件清单缺少 id');
    }
    if (!manifest.pages?.content) {
      throw new Error(`插件缺少内容页：${manifest.id}`);
    }
    this.stages.set(manifest.id, 'resolve');
  }

  /** 激活：登记资源、命令、页面；失败时撤销已登记部分。 */
  async activate(
    pkg: PluginPackage,
    contribution: PluginContribution,
  ): Promise<void> {
    try {
      this.manager.register(pkg, contribution);
      this.protocols.registerPlugin(pkg);
      await this.manager.activate(pkg.manifest.id);
      const scope = this.manager.scopeOf(pkg.manifest.id);
      if (scope) await contribution.lifecycle?.activate?.(scope);
      // 运行时已就绪：插件列表第一次取数放在这里。
      this.manager.touchLists(pkg.manifest.id);
      this.stages.set(pkg.manifest.id, 'activate');
    } catch (error) {
      // 激活中途失败：先让插件释放已创建的运行时，再撤销注册。
      const scope = this.manager.scopeOf(pkg.manifest.id);
      if (scope) {
        await Promise.resolve(
          contribution.lifecycle?.deactivate?.(scope),
        ).catch(() => undefined);
      }
      await this.manager.revoke(pkg.manifest.id);
      this.protocols.unregisterPlugin(pkg.manifest.id);
      throw error;
    }
  }

  /** 域可路由、命令入表、页面可开。 */
  ready(pluginId: string): void {
    this.stages.set(pluginId, 'ready');
  }

  async deactivate(pluginId: string): Promise<void> {
    const registration = this.manager.get(pluginId);
    const scope = this.manager.scopeOf(pluginId);
    try {
      if (scope) {
        await registration?.contribution.lifecycle?.deactivate?.(scope);
      }
    } finally {
      await this.manager.revoke(pluginId);
      this.protocols.unregisterPlugin(pluginId);
      this.stages.set(pluginId, 'deactivate');
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    if (this.stages.get(pluginId) !== 'deactivate') {
      await this.deactivate(pluginId);
    }
    this.stages.set(pluginId, 'uninstall');
  }

  stageOf(pluginId: string): PluginStage | null {
    return this.stages.get(pluginId) ?? null;
  }
}
