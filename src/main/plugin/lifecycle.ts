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
      await contribution.lifecycle?.activate?.();
      this.stages.set(pkg.manifest.id, 'activate');
    } catch (error) {
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
    try {
      await registration?.contribution.lifecycle?.deactivate?.();
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
