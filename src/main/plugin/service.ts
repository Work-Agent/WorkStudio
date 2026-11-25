/**
 * 插件安装与激活服务。
 *
 * 安装存储归 PluginStore；激活/撤销归 PluginLifecycle；这里只编排
 * “读清单 → 解析 → 载入 ESM → 登记贡献”，不解释插件能力。
 */

import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { PluginContribution } from '@workstudio/sdk';
import { mergeStaticCommands } from './commands.ts';
import { notImplemented } from '../contract.ts';
import type { PluginFiles } from './files.ts';
import type { PluginLifecycle, PluginStage } from './lifecycle.ts';
import type { PluginPackage } from './manifest.ts';
import type { PluginCatalogService, CatalogResult } from './catalog.ts';
import type { PluginStore } from './store.ts';

export interface PluginTask {
  id: string;
  status: 'idle' | 'installing' | 'ready' | 'error';
  progress?: number;
  message?: string;
}

export interface PluginServiceOptions {
  store: PluginStore;
  lifecycle: PluginLifecycle;
  catalog: PluginCatalogService;
  files: PluginFiles;
}

export class PluginService {
  task: PluginTask | null = null;

  constructor(private readonly options: PluginServiceOptions) {}

  async start(): Promise<void> {
    this.options.store.ensure();
    await this.options.catalog.start();
  }

  list(): PluginPackage[] {
    return this.options.store.list();
  }

  catalog(): CatalogResult | null {
    return this.options.catalog.current();
  }

  stageOf(pluginId: string): PluginStage | null {
    return this.options.lifecycle.stageOf(pluginId);
  }

  /** 激活：清单校验 → ESM 导出 → 生命周期登记。 */
  async activate(pluginId: string): Promise<void> {
    if (this.options.lifecycle.stageOf(pluginId) === 'ready') return;
    const pkg = this.options.store.read(pluginId);
    if (!pkg) throw new Error(`插件不存在：${pluginId}`);
    await this.options.lifecycle.resolve(pkg);
    const module = (await import(pathToFileURL(pkg.entry).href)) as {
      workstudio?: PluginContribution;
      default?: PluginContribution;
    };
    const contribution = module.workstudio ?? module.default;
    if (!contribution) {
      throw new Error(`插件入口没有导出 workstudio：${pluginId}`);
    }
    const commands = mergeStaticCommands(
      pkg,
      contribution.commands as unknown as Record<
        string,
        { summary: string; args: Record<string, unknown>; run: unknown }
      >,
    ) as unknown as PluginContribution['commands'];
    await this.options.lifecycle.activate(pkg, { ...contribution, commands });
    this.options.lifecycle.ready(pluginId);
  }

  async deactivate(pluginId: string): Promise<void> {
    await this.options.lifecycle.deactivate(pluginId);
  }

  async reload(pluginId: string): Promise<void> {
    await this.deactivate(pluginId);
    await this.activate(pluginId);
  }

  async uninstall(pluginId: string): Promise<void> {
    await this.options.lifecycle.uninstall(pluginId);
    // 先清内存 token 与导入复制件，再删安装 / 数据目录。
    await this.options.files.removePlugin(pluginId);
    this.options.store.remove(pluginId);
  }

  /** 本地目录 / 本地 zip / http(s) zip 统一落到 installed。 */
  async install(source: string): Promise<PluginPackage> {
    const value = source.trim();
    if (!value) throw new Error('插件来源不能为空');
    let pkg: PluginPackage;
    try {
      const info = statSync(value);
      if (info.isDirectory()) {
        pkg = this.options.store.installDirectory(value);
      } else if (/\.zip$/i.test(value)) {
        pkg = this.options.store.installZip(readFileSync(value));
      } else {
        notImplemented('plugin/install');
      }
    } catch (error) {
      if (!/^https?:\/\//i.test(value)) throw error;
      const response = await fetch(value, {
        headers: { 'User-Agent': 'work-studio' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok)
        throw new Error(`插件下载失败：HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 64 * 1024 * 1024) {
        throw new Error('插件包超过 64MB');
      }
      pkg = this.options.store.installZip(bytes);
    }
    if (this.options.lifecycle.stageOf(pkg.manifest.id) === 'ready') {
      await this.deactivate(pkg.manifest.id);
    }
    await this.options.lifecycle.install(pkg);
    return pkg;
  }

  async refreshCatalog(): Promise<CatalogResult> {
    return this.options.catalog.load();
  }
}
