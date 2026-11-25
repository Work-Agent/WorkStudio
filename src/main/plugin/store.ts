/**
 * 插件安装存储：目录即真相源。
 *
 * 运行期只认 plugins/installed/<id>；id、版本、来源都从包内 package.json
 * 现场读取，不再维护中心索引。staging 只承接未提交的包，recovery 只用于
 * 原子替换的失败恢复。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import type { WorkStudioManifest } from '@work-studio/sdk';
import type { StorageLayout } from '../platform/paths.ts';
import { readJson, writeJson } from '../platform/json.ts';
import { isReservedPluginId, type PluginPackage } from './manifest.ts';

export interface BuiltinPackage {
  id: string;
  /** 构建期资产目录；调用方负责提供，不从 appRoot 推导。 */
  sourceDir: string;
}

/** 扫描 installed 的结果：坏包保留目录名与错误，仍可卸载。 */
export interface InstalledPlugin {
  id: string;
  version: string;
  package: PluginPackage | null;
  error: string | null;
}

/** 已复制到 staging、尚未提交的插件包。 */
export interface StagedPlugin {
  package: PluginPackage;
  /** 本次 staging 的清理根；提交成功后整棵删除。 */
  cleanupRoot: string;
}

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_FILES = 20_000;

export class PluginStore {
  constructor(private readonly layout: StorageLayout) {}

  ensure(): void {
    for (const path of [
      this.layout.pluginsInstalledRoot,
      this.layout.pluginsDataRoot,
      this.layout.pluginsTmpRoot,
      this.layout.pluginsStagingRoot,
      this.layout.pluginsRecoveryRoot,
      this.layout.pluginsCatalogRoot,
    ]) {
      mkdirSync(path, { recursive: true });
    }
  }

  /** 启动时恢复中断的替换：target 缺失则把最新的 recovery 放回。 */
  recover(): void {
    this.ensure();
    for (const id of readdirSync(this.layout.pluginsRecoveryRoot)) {
      const root = join(this.layout.pluginsRecoveryRoot, id);
      if (!statSync(root).isDirectory()) {
        rmSync(root, { force: true });
        continue;
      }
      const target = this.pathOf(id);
      if (!existsSync(target)) {
        const stamps = readdirSync(root).sort().reverse();
        const stamp = stamps[0];
        if (stamp) renameSync(join(root, stamp), target);
      }
      rmSync(root, { recursive: true, force: true });
    }
  }

  installedRoot(): string {
    return this.layout.pluginsInstalledRoot;
  }

  pathOf(pluginId: string): string {
    assertPluginId(pluginId);
    return join(this.layout.pluginsInstalledRoot, pluginId);
  }

  dataRootOf(pluginId: string): string {
    assertPluginId(pluginId);
    return join(this.layout.pluginsDataRoot, pluginId);
  }

  tempDirOf(pluginId: string): string {
    return join(this.layout.pluginsTmpRoot, pluginId);
  }

  settingsFileOf(pluginId: string): string {
    return join(this.dataRootOf(pluginId), 'settings.json');
  }

  readSettings(pluginId: string): Record<string, unknown> {
    return readJson(this.settingsFileOf(pluginId));
  }

  writeSettings(pluginId: string, value: Record<string, unknown>): void {
    writeJson(this.settingsFileOf(pluginId), value);
  }

  /** 扫描全部目录；坏包也保留，供诊断与卸载。 */
  scan(): InstalledPlugin[] {
    this.ensure();
    const result: InstalledPlugin[] = [];
    for (const entry of readdirSync(this.layout.pluginsInstalledRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const id = entry.name;
      if (!ID_RE.test(id)) continue;
      const root = join(this.layout.pluginsInstalledRoot, id);
      try {
        const pkg = this.inspectAt(root, id);
        result.push({
          id,
          version: pkg.version,
          package: pkg,
          error: null,
        });
      } catch (error) {
        result.push({
          id,
          version: readVersion(root),
          package: null,
          error: messageOf(error),
        });
      }
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** 只返回可装载的包。 */
  list(): PluginPackage[] {
    return this.scan().flatMap((item) => (item.package ? [item.package] : []));
  }

  read(pluginId: string): PluginPackage | null {
    try {
      return this.inspectAt(this.pathOf(pluginId), pluginId);
    } catch {
      return null;
    }
  }

  /** 本地目录 / zip 解包后的统一入口：先复制到 staging 并校验。 */
  stageDirectory(sourceDir: string): StagedPlugin {
    this.ensure();
    if (!statSync(sourceDir).isDirectory()) {
      throw new Error('插件来源必须是目录');
    }
    const cleanupRoot = join(
      this.layout.pluginsStagingRoot,
      `stage-${randomUUID()}`,
    );
    rmSync(cleanupRoot, { recursive: true, force: true });
    cpSync(sourceDir, cleanupRoot, { recursive: true });
    try {
      const pkg = this.inspectAt(cleanupRoot);
      return { package: pkg, cleanupRoot };
    } catch (error) {
      rmSync(cleanupRoot, { recursive: true, force: true });
      throw error;
    }
  }

  stageZip(bytes: Uint8Array): StagedPlugin {
    this.ensure();
    if (bytes.byteLength > MAX_ZIP_BYTES) {
      throw new Error('插件包超过 64MB');
    }
    const cleanupRoot = join(
      this.layout.pluginsStagingRoot,
      `zip-${randomUUID()}`,
    );
    rmSync(cleanupRoot, { recursive: true, force: true });
    mkdirSync(cleanupRoot, { recursive: true });
    try {
      let rejected: string | null = null;
      let count = 0;
      let total = 0;
      const files = unzipSync(bytes, {
        filter: (file) => {
          count += 1;
          if (count > MAX_ZIP_FILES) {
            rejected ??= '文件数量过多';
            return false;
          }
          const normalized = file.name.replace(/\\/g, '/').replace(/^\.\//, '');
          if (!normalized) {
            rejected ??= '包含空路径';
            return false;
          }
          if (normalized.endsWith('/')) return false;
          if (
            normalized.startsWith('/') ||
            normalized.includes(':') ||
            normalized.split('/').includes('..')
          ) {
            rejected ??= `包含非法路径：${file.name}`;
            return false;
          }
          if (total + file.originalSize > MAX_UNPACKED_BYTES) {
            rejected ??= '解压后超过 256MB';
            return false;
          }
          total += file.originalSize;
          return true;
        },
      });
      if (rejected) throw new Error(`插件包${rejected}`);
      for (const [name, data] of Object.entries(files)) {
        const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!normalized || normalized.endsWith('/')) continue;
        const file = join(cleanupRoot, normalized);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, data);
      }
      const root = findPackageRoot(cleanupRoot);
      if (!root) throw new Error('zip 中缺少 package.json');
      const pkg = this.inspectAt(root);
      return { package: pkg, cleanupRoot };
    } catch (error) {
      rmSync(cleanupRoot, { recursive: true, force: true });
      throw error;
    }
  }

  /** 原子替换：旧包进 recovery，失败恢复；成功后清理。 */
  commit(staged: StagedPlugin): PluginPackage {
    const id = staged.package.manifest.id;
    const target = this.pathOf(id);
    const recoveryRoot = join(this.layout.pluginsRecoveryRoot, id);
    const recovery = join(recoveryRoot, String(Date.now()));
    let moved = false;
    try {
      if (existsSync(target)) {
        mkdirSync(recoveryRoot, { recursive: true });
        renameSync(target, recovery);
        moved = true;
      }
      renameSync(staged.package.root, target);
      const installed = this.read(id);
      if (!installed) throw new Error(`插件提交后不可读：${id}`);
      if (moved) rmSync(recoveryRoot, { recursive: true, force: true });
      return installed;
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      if (moved && existsSync(recovery)) {
        renameSync(recovery, target);
      }
      throw error;
    } finally {
      rmSync(staged.cleanupRoot, { recursive: true, force: true });
    }
  }

  discard(staged: StagedPlugin): void {
    rmSync(staged.cleanupRoot, { recursive: true, force: true });
  }

  /** 内置包播种：同版本跳过，新版本替换包体，保留 plugins/data。 */
  seedBuiltin(builtin: BuiltinPackage): boolean {
    this.ensure();
    const current = this.read(builtin.id);
    if (
      current &&
      readVersion(builtin.sourceDir) === current.version &&
      current.version !== '0.0.0'
    ) {
      return false;
    }
    const staged = this.stageDirectory(builtin.sourceDir);
    try {
      this.commit(staged);
    } catch (error) {
      this.discard(staged);
      throw error;
    }
    return true;
  }

  remove(pluginId: string, removeData = true): void {
    rmSync(this.pathOf(pluginId), { recursive: true, force: true });
    // v2 文件导入会复制到 tmp；卸载时一并清掉。
    rmSync(this.tempDirOf(pluginId), { recursive: true, force: true });
    if (removeData) {
      rmSync(this.dataRootOf(pluginId), { recursive: true, force: true });
    }
  }

  /** 读取并校验一个包目录；expectedId 用于 installed/<id> 的目录名核对。 */
  private inspectAt(root: string, expectedId?: string): PluginPackage {
    const pkgFile = join(root, 'package.json');
    if (!existsSync(pkgFile)) throw new Error('缺少 package.json');
    const raw = readFileSync(pkgFile, 'utf-8');
    let pkg: {
      version?: unknown;
      exports?: string | Record<string, unknown>;
      workstudio?: unknown;
      workStudio?: unknown;
    };
    try {
      pkg = JSON.parse(raw) as typeof pkg;
    } catch {
      throw new Error('package.json 无法解析');
    }
    const manifest = (pkg.workstudio ?? pkg.workStudio) as
      | WorkStudioManifest
      | undefined;
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('缺少 workstudio 清单');
    }
    if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) {
      throw new Error('插件 id 非法');
    }
    if (isReservedPluginId(manifest.id)) {
      throw new Error(`插件 id 保留：${manifest.id}`);
    }
    if (expectedId && manifest.id !== expectedId) {
      throw new Error(`清单 id 与目录名不一致：${manifest.id} ≠ ${expectedId}`);
    }
    if (!manifest.pages?.content) {
      throw new Error('缺少内容页');
    }
    const entry = resolveExport(root, pkg.exports);
    if (!entry || !existsSync(entry)) {
      throw new Error("缺少 exports['./workstudio'] 入口");
    }
    const contentPage = join(root, manifest.pages.content);
    if (!existsSync(contentPage)) {
      throw new Error('内容页文件不存在');
    }
    const settingsPage = manifest.pages.settings
      ? join(root, manifest.pages.settings)
      : null;
    if (settingsPage && !existsSync(settingsPage)) {
      throw new Error('设置页文件不存在');
    }
    const commandsFile = join(root, 'commands.json');
    if (!existsSync(commandsFile)) {
      throw new Error('缺少 commands.json');
    }
    try {
      JSON.parse(readFileSync(commandsFile, 'utf-8'));
    } catch {
      throw new Error('commands.json 无法解析');
    }
    return {
      manifest,
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      root,
      entry,
      contentPage,
      ...(settingsPage ? { settingsPage } : {}),
    };
  }
}

function assertPluginId(pluginId: string): void {
  if (!ID_RE.test(pluginId)) throw new Error(`插件 id 非法：${pluginId}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf-8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveExport(
  root: string,
  exportsValue: string | Record<string, unknown> | undefined,
): string | null {
  const key = './workstudio';
  if (typeof exportsValue === 'string') return join(root, exportsValue);
  const entry = exportsValue?.[key] ?? exportsValue?.['workstudio'];
  if (typeof entry === 'string') return join(root, entry);
  if (typeof entry === 'object' && entry !== null) {
    const fallback = (entry as { default?: unknown }).default;
    if (typeof fallback === 'string') return join(root, fallback);
  }
  return null;
}

function findPackageRoot(root: string): string | null {
  if (existsSync(join(root, 'package.json'))) return root;
  for (const name of readdirSync(root)) {
    const child = join(root, name);
    if (!statSync(child).isDirectory()) continue;
    const found = findPackageRoot(child);
    if (found) return found;
  }
  return null;
}
