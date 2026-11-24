/**
 * plugin 模块：安装、目录、任务与运行时激活。
 *
 * 依赖 workspace 只用于当前工作区与认领路径；插件域本身是 App 级注册表，
 * 工作区切换时由 PluginService 负责重新激活/撤销。
 */

import type { DomainModule } from '../../registry/module.ts';
import type { DomainRegistry } from '../../registry/registry.ts';
import type { PluginLifecycle } from '../../plugin/lifecycle.ts';
import type { PluginService } from '../../plugin/service.ts';
import type { PluginStore } from '../../plugin/store.ts';
import {
  createPluginState,
  definePluginResources,
  type PluginState,
} from './domains.ts';

export class PluginModule implements DomainModule {
  readonly id = 'plugin';
  readonly dependencies = ['workspace'] as const;

  private readonly state: PluginState = createPluginState();

  constructor(
    private readonly store: PluginStore,
    private readonly service: PluginService,
    private readonly lifecycle: PluginLifecycle,
  ) {}

  attach(registry: DomainRegistry): void {
    definePluginResources(
      registry,
      this.state,
      this.store,
      this.service,
      this.lifecycle,
    );
  }

  async start(): Promise<void> {
    this.store.ensure();
    await this.service.start();
    for (const pkg of this.store.list()) {
      try {
        await this.service.activate(pkg.manifest.id);
      } catch (error) {
        console.warn(`[plugin] activate failed: ${pkg.manifest.id}`, error);
      }
    }
  }

  async stop(): Promise<void> {
    for (const pkg of this.store.list()) {
      if (this.lifecycle.stageOf(pkg.manifest.id) === 'ready') {
        await this.service.deactivate(pkg.manifest.id);
      }
    }
    this.state.catalog = [];
    this.state.task = null;
  }
}
