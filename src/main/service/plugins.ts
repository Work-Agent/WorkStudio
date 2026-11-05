/**
 * 插件业务：来源管理 + 目录 + 插件自持设置。
 * 路径绑定在 routes.ts。
 */

import type { CatalogResult, PluginCatalogService } from '../plugins/catalog';
import type { PluginHost, PluginPageEntry } from '../plugins/host';
import type { PluginService } from '../plugins/service';
import type { PluginSource } from '../../shared/plugin-registry';

export interface PluginsDeps {
  service: PluginService;
  catalog: PluginCatalogService;
  host: PluginHost;
}

export class PluginsService {
  private readonly changeListeners = new Set<() => void>();
  private readonly catalogListeners = new Set<
    (result: CatalogResult) => void
  >();

  constructor(private readonly deps: PluginsDeps) {}

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onCatalog(listener: (result: CatalogResult) => void): () => void {
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }

  installed(): PluginSource[] {
    return this.deps.service.list();
  }

  runtime() {
    return this.deps.host.pluginInfoList();
  }

  /**
   * 插件页面出口（未做选择）：调用方按自己的入口取 page / settings。
   *
   * 不做「缺哪个就用另一个」的兜底——查看器出口与配置面出口语义不同，
   * 静默兜底会把插件入口导向无文档的渲染页（历史回归点）。
   */
  entry(pluginId: string): PluginPageEntry | null {
    return this.deps.host.getPage(pluginId);
  }

  async install(source: string): Promise<PluginSource> {
    const entry = await this.deps.service.install(source);
    // 热安装：装入运行时并执行注册入口，失败只进诊断（文件已落盘，重启后仍会装载）。
    const root = this.deps.service.installRootOf(entry.source);
    if (root) await this.deps.host.activate(root);
    this.emitChange();
    return entry;
  }

  async remove(source: string): Promise<boolean> {
    // 热卸载：先撤销注册面并关闭插件视图，再删安装目录。
    // 同 id 还被其他来源安装时不撤运行时（插件仍处于安装状态）。
    const pluginId = this.deps.service.installedIdOf(source);
    if (pluginId && !this.deps.service.isSharedId(pluginId, source)) {
      this.deps.host.deactivate(pluginId);
    }
    const removed = await this.deps.service.remove(source);
    this.emitChange();
    return removed;
  }

  async refreshCatalog(url?: string): Promise<CatalogResult> {
    const result = await this.deps.catalog.load(url);
    for (const listener of this.catalogListeners) listener(result);
    return result;
  }

  getSetting<T>(pluginId: string, key: string, fallback: T): Promise<T> {
    return this.deps.host.getSetting(pluginId, key, fallback);
  }

  setSetting(
    pluginId: string,
    key: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    return this.deps.host.setSetting(pluginId, key, value);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
