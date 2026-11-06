import type { PluginInstallTask } from '../../shared/plugin-install';
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
  private taskView: PluginInstallTask | null = null;
  private controller: AbortController | null = null;
  private readonly taskListeners = new Set<(task: PluginInstallTask) => void>();
  private readonly attempts = new Map<string, number>();
  private taskSeq = 0;
  private readonly idleListeners = new Set<() => void>();
  get task(): PluginInstallTask | null {
    return this.taskView ? { ...this.taskView } : null;
  }
  onTask(listener: (task: PluginInstallTask) => void): () => void {
    this.taskListeners.add(listener);
    return () => this.taskListeners.delete(listener);
  }
  private publishTask(): void {
    if (this.taskView)
      for (const listener of this.taskListeners) listener({ ...this.taskView });
  }
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

  async install(source: string, loadOnly = false): Promise<PluginSource> {
    if (
      this.taskView &&
      ['running', 'cancelling'].includes(this.taskView.status)
    )
      throw new Error('已有插件安装任务，请等待或取消当前任务');
    const attempt = (this.attempts.get(source) ?? 0) + 1;
    this.attempts.set(source, attempt);
    const task: PluginInstallTask = {
      id: `install-${++this.taskSeq}`,
      source,
      label: source,
      sourceType: /^https?:/.test(source) ? 'remote' : 'local',
      status: 'running',
      phase: loadOnly ? 'load' : 'download',
      attempt,
      received: 0,
      total: null,
      installed: loadOnly,
      loaded: false,
      message: loadOnly ? '正在重新加载插件' : '正在准备安装',
      error: null,
    };
    this.taskView = task;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.publishTask();
    try {
      const entry = loadOnly
        ? this.installed().find((item) => item.source === source && item.name)
        : await this.deps.service.install(source, {
            signal,
            progress: (progress) => {
              Object.assign(task, progress);
              this.publishTask();
            },
          });
      if (!entry) throw new Error('插件尚未安装，无法重新加载');
      task.installed = true;
      task.label = entry.label ?? entry.name ?? source;
      this.emitChange();
      if (signal.aborted) {
        task.status = 'cancelled';
        task.message = '文件已安装，已取消后续加载。可以稍后单独加载。';
        this.publishTask();
        return entry;
      }
      task.phase = 'load';
      task.message = '安装完成，正在加载插件能力';
      this.publishTask();
      const root = this.deps.service.installRootOf(entry.source);
      if (!root || !(await this.deps.host.activate(root)))
        throw new Error('安装文件未能加载为插件');
      task.loaded = true;
      task.status = 'done';
      task.message = signal.aborted
        ? '取消请求到达时，插件已安装并加载完成'
        : '安装完成，插件已加载';
      this.publishTask();
      return entry;
    } catch (error) {
      task.error = error instanceof Error ? error.message : String(error);
      if (signal.aborted && task.phase !== 'load') {
        task.status = 'cancelled';
        task.message = task.installed
          ? '文件已安装，后续加载已取消'
          : '安装已取消，插件未启用';
      } else {
        task.status = 'failed';
        task.message =
          task.phase === 'load'
            ? '已安装，但加载失败'
            : task.phase === 'verify'
              ? '安装包或插件信息校验失败'
              : task.phase === 'install'
                ? '插件安装未完成'
                : '安装包读取或下载失败';
      }
      this.publishTask();
      throw error;
    } finally {
      this.controller = null;
      for (const resolve of this.idleListeners) resolve();
      this.idleListeners.clear();
      this.emitChange();
    }
  }

  cancelInstall(): PluginInstallTask | null {
    if (this.taskView?.status === 'running') {
      this.taskView.status = 'cancelling';
      this.taskView.message = '已请求取消，正在等待当前步骤结束';
      this.controller?.abort(new Error('安装已取消'));
      this.publishTask();
    }
    return this.task;
  }

  async cancelAndWait(): Promise<void> {
    if (
      !this.taskView ||
      !['running', 'cancelling'].includes(this.taskView.status)
    )
      return;
    const idle = new Promise<void>((resolve) =>
      this.idleListeners.add(resolve),
    );
    this.cancelInstall();
    await idle;
  }

  retryInstall(): Promise<PluginSource> {
    if (
      !this.taskView ||
      !['failed', 'cancelled'].includes(this.taskView.status)
    )
      throw new Error('当前没有可重试的安装任务');
    if (
      this.taskView.phase === 'verify' &&
      this.taskView.error?.includes('sha256')
    )
      throw new Error('安装包校验不通过，请更换来源');
    return this.install(
      this.taskView.source,
      this.taskView.installed && !this.taskView.loaded,
    );
  }

  async remove(source: string): Promise<boolean> {
    if (
      this.taskView &&
      ['running', 'cancelling'].includes(this.taskView.status)
    )
      throw new Error('请等待当前安装任务结束，再卸载插件');
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
