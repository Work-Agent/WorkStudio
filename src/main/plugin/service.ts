/**
 * 插件安装与激活服务。
 *
 * 安装存储归 PluginStore；激活/撤销归 PluginLifecycle；目录归
 * PluginCatalogService；这里只编排来源解析、下载校验、提交与任务状态。
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginContribution } from '@work-studio/sdk';
import { CallFailure } from '../contract.ts';
import type { CatalogResult } from './catalog.ts';
import { mergeStaticCommands } from './commands.ts';
import type { PluginFiles } from './files.ts';
import type { PluginLifecycle } from './lifecycle.ts';
import type { PluginPackage } from './manifest.ts';
import type { PluginCatalogService } from './catalog.ts';
import type { PluginStore, StagedPlugin } from './store.ts';

export type PluginChange = 'task' | 'installed' | 'catalog';

export type PluginTaskPhase =
  | 'resolve'
  | 'download'
  | 'verify'
  | 'unpack'
  | 'validate'
  | 'commit'
  | 'activate';

export interface PluginTask {
  id: string;
  source: string;
  label: string;
  status: 'running' | 'ready' | 'error' | 'cancelled';
  phase: PluginTaskPhase;
  received: number;
  total: number | null;
  message: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface PluginServiceOptions {
  store: PluginStore;
  lifecycle: PluginLifecycle;
  catalog: PluginCatalogService;
  files: PluginFiles;
  isBuiltin?(pluginId: string): boolean;
}

interface ResolvedSource {
  kind: 'dir' | 'zip' | 'remote';
  label: string;
  path?: string;
  bytes?: Uint8Array;
  url?: string;
  sha256?: string;
  expectedId?: string;
}

const MAX_ZIP_BYTES = 64 * 1024 * 1024;

export class PluginService {
  task: PluginTask | null = null;

  private controller: AbortController | null = null;
  private busy = false;
  private readonly listeners = new Set<(type: PluginChange) => void>();

  constructor(private readonly options: PluginServiceOptions) {}

  async start(): Promise<void> {
    this.options.store.ensure();
    this.options.store.recover();
    await this.options.catalog.start();
  }

  onChange(listener: (type: PluginChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  catalog(): CatalogResult {
    return this.options.catalog.current();
  }

  /** 激活：清单校验 → ESM 导出 → 生命周期登记。 */
  async activate(pluginId: string): Promise<void> {
    if (this.options.lifecycle.stageOf(pluginId) === 'ready') return;
    const pkg = this.options.store.read(pluginId);
    if (!pkg) {
      const error = new Error(`插件不存在或包已损坏：${pluginId}`);
      this.options.lifecycle.fail(pluginId, error);
      this.notify('installed');
      throw error;
    }
    try {
      await this.options.lifecycle.resolve(pkg);
      const url = pathToFileURL(pkg.entry);
      // 重新安装后必须拿到新的模块实例；相对导入仍会被 Node 缓存。
      url.searchParams.set('v', String(Date.now()));
      const module = (await import(url.href)) as {
        workstudio?: PluginContribution;
        default?: PluginContribution;
      };
      const contribution = module.workstudio ?? module.default;
      if (!contribution) {
        throw new Error(`插件入口没有导出 workstudio：${pluginId}`);
      }
      const commands = mergeStaticCommands(
        pkg,
        (contribution.commands ?? {}) as unknown as Record<
          string,
          { summary: string; args: Record<string, unknown>; run: unknown }
        >,
      ) as unknown as PluginContribution['commands'];
      await this.options.lifecycle.activate(pkg, { ...contribution, commands });
      this.options.lifecycle.ready(pluginId);
    } catch (error) {
      this.options.lifecycle.fail(pluginId, error);
      throw error;
    } finally {
      this.notify('installed');
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    try {
      await this.options.lifecycle.deactivate(pluginId);
    } finally {
      this.notify('installed');
    }
  }

  async reload(pluginId: string): Promise<void> {
    if (this.busy)
      throw new CallFailure('failed', '安装任务进行中，暂不能重载');
    await this.deactivate(pluginId);
    await this.activate(pluginId);
  }

  async uninstall(pluginId: string, purgeData = false): Promise<void> {
    if (this.busy)
      throw new CallFailure('failed', '安装任务进行中，暂不能卸载');
    if (this.options.isBuiltin?.(pluginId)) {
      throw new CallFailure('denied', '内置插件不可卸载');
    }
    await this.options.lifecycle.uninstall(pluginId);
    // 先清内存 token 与导入复制件，再删安装 / 数据目录。
    await this.options.files.removePlugin(pluginId);
    this.options.store.remove(pluginId, purgeData);
    this.notify('installed');
  }

  async refreshCatalog(url?: string): Promise<CatalogResult> {
    const result = await this.options.catalog.load(url);
    this.notify('catalog');
    return result;
  }

  async setCatalogUrl(url: string): Promise<CatalogResult> {
    if (!url.trim()) {
      await this.options.catalog.setUrl('');
      const result = this.options.catalog.current();
      this.notify('catalog');
      return result;
    }
    await this.options.catalog.setUrl(url);
    return this.refreshCatalog();
  }

  clearTask(): void {
    if (this.task?.status === 'running') return;
    this.task = null;
    this.notify('task');
  }

  /** 取消当前任务的下载 / 校验；提交阶段不可取消。 */
  async cancel(): Promise<void> {
    if (!this.task || this.task.status !== 'running') return;
    if (this.task.phase === 'commit' || this.task.phase === 'activate') {
      throw new CallFailure('failed', '已进入提交阶段，无法取消');
    }
    this.controller?.abort();
  }

  /** 本地目录 / 本地 zip / catalog:<id> / 远程 zip 统一安装。 */
  async install(source: string): Promise<string> {
    if (this.busy) throw new CallFailure('failed', '已有安装任务进行中');
    const value = source.trim();
    if (!value) throw new CallFailure('invalid', '插件来源不能为空');

    this.busy = true;
    const controller = new AbortController();
    this.controller = controller;
    this.task = {
      id: randomUUID(),
      source: value,
      label: value,
      status: 'running',
      phase: 'resolve',
      received: 0,
      total: null,
      message: '正在解析来源',
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.notify('task');

    let staged: StagedPlugin | null = null;
    let committed = false;
    try {
      const resolved = await this.resolveSource(value);
      this.updateTask({ label: resolved.label });

      if (resolved.kind === 'remote') {
        const bytes = await this.download(resolved.url!, resolved.sha256!);
        this.throwIfAborted();
        this.updateTask({ phase: 'unpack', message: '正在解包' });
        staged = this.options.store.stageZip(bytes);
      } else {
        this.throwIfAborted();
        this.updateTask({ phase: 'validate', message: '正在校验插件包' });
        staged =
          resolved.kind === 'dir'
            ? this.options.store.stageDirectory(resolved.path!)
            : this.options.store.stageZip(resolved.bytes!);
      }

      const id = staged.package.manifest.id;
      if (resolved.expectedId && id !== resolved.expectedId) {
        throw new CallFailure(
          'invalid',
          `插件 id 与目录条目不一致：${id} ≠ ${resolved.expectedId}`,
        );
      }
      if (this.options.isBuiltin?.(id)) {
        throw new CallFailure('denied', `内置插件 id 保留：${id}`);
      }
      this.throwIfAborted();

      const wasReady = this.options.lifecycle.stageOf(id) === 'ready';
      if (wasReady) await this.deactivate(id);

      this.updateTask({ phase: 'commit', message: '正在提交安装' });
      let installed: PluginPackage;
      try {
        installed = this.options.store.commit(staged);
        committed = true;
        staged = null;
      } catch (error) {
        if (wasReady) await this.activate(id).catch(() => undefined);
        throw error;
      }

      await this.options.lifecycle.install(installed);
      this.updateTask({ phase: 'activate', message: '正在激活插件' });
      await this.activate(installed.manifest.id);

      this.finishTask({
        status: 'ready',
        message: '安装完成',
        received: this.task?.received ?? 0,
      });
      return installed.manifest.id;
    } catch (error) {
      if (staged) this.options.store.discard(staged);
      if (controller.signal.aborted) {
        this.finishTask({
          status: 'cancelled',
          message: '安装已取消',
        });
        throw new CallFailure('failed', '安装已取消');
      }
      this.finishTask({
        status: 'error',
        message: committed ? '插件已安装，但激活失败' : '安装失败',
        error: messageOf(error),
      });
      throw error;
    } finally {
      this.busy = false;
      this.controller = null;
      this.notify('installed');
    }
  }

  private async resolveSource(source: string): Promise<ResolvedSource> {
    if (source.startsWith('catalog:')) {
      const id = source.slice('catalog:'.length).trim();
      const entry = this.options.catalog.entry(id);
      if (!entry) {
        throw new CallFailure('not_found', `目录中没有插件：${id}`);
      }
      if (entry.deprecated) {
        throw new CallFailure('invalid', `插件已下架：${id}`);
      }
      return {
        kind: 'remote',
        label: entry.name,
        url: entry.source,
        sha256: entry.sha256,
        expectedId: entry.id,
      };
    }

    if (/^https?:\/\//i.test(source)) {
      const parsed = new URL(source);
      const match = /^sha256=([a-f0-9]{64})$/i.exec(
        parsed.hash.replace(/^#/, ''),
      );
      if (!match) {
        throw new CallFailure(
          'invalid',
          '远程插件必须带 #sha256=<64位十六进制>',
        );
      }
      parsed.hash = '';
      return {
        kind: 'remote',
        label: basename(parsed.pathname) || parsed.host,
        url: parsed.href,
        sha256: match[1]!.toLowerCase(),
      };
    }

    if (!isAbsolute(source)) {
      throw new CallFailure('invalid', '本地路径必须是绝对路径');
    }
    let info;
    try {
      info = statSync(source);
    } catch {
      throw new CallFailure('not_found', `插件来源不存在：${source}`);
    }
    if (info.isDirectory()) {
      return {
        kind: 'dir',
        label: basename(source),
        path: source,
      };
    }
    if (!/\.zip$/i.test(source)) {
      throw new CallFailure('invalid', '插件来源必须是目录或 zip');
    }
    const bytes = new Uint8Array(readFileSync(source));
    if (bytes.byteLength > MAX_ZIP_BYTES) {
      throw new CallFailure('invalid', '插件包超过 64MB');
    }
    return {
      kind: 'zip',
      label: basename(source),
      bytes,
    };
  }

  private async download(url: string, expected: string): Promise<Uint8Array> {
    this.updateTask({ phase: 'download', message: '正在下载' });
    const controller = this.controller;
    if (!controller) throw new Error('安装任务已结束');
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(60_000),
    ]);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'work-studio' },
      signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new CallFailure('failed', `插件下载失败：HTTP ${response.status}`);
    }
    const total = Number(response.headers.get('content-length') ?? '0');
    if (total > MAX_ZIP_BYTES)
      throw new CallFailure('invalid', '插件包超过 64MB');
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastNotify = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        if (received > MAX_ZIP_BYTES) {
          throw new CallFailure('invalid', '插件包超过 64MB');
        }
        chunks.push(chunk);
        const now = Date.now();
        if (now - lastNotify > 100) {
          lastNotify = now;
          this.updateTask({
            received,
            total: total > 0 ? total : null,
          });
        }
      }
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer());
      received = buffer.byteLength;
      chunks.push(buffer);
    }
    this.updateTask({
      phase: 'verify',
      message: '正在校验完整性',
      received,
      total: total > 0 ? total : null,
    });
    const bytes = concat(chunks, received);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) {
      throw new CallFailure(
        'invalid',
        `sha256 校验失败：期望 ${expected}，实际 ${actual}`,
      );
    }
    return bytes;
  }

  private updateTask(patch: Partial<PluginTask>): void {
    if (!this.task) return;
    this.task = { ...this.task, ...patch };
    this.notify('task');
  }

  private finishTask(patch: Partial<PluginTask>): void {
    if (!this.task) return;
    this.task = {
      ...this.task,
      ...patch,
      error: patch.error ?? null,
      finishedAt: Date.now(),
    };
    this.notify('task');
  }

  private throwIfAborted(): void {
    if (this.controller?.signal.aborted) {
      throw new CallFailure('failed', '安装已取消');
    }
  }

  private notify(type: PluginChange): void {
    for (const listener of this.listeners) listener(type);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
