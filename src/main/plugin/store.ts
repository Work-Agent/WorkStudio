/**
 * 插件安装存储：运行期只认 plugins/installed。
 *
 * 内置插件作为构建态资产播种到同一目录；安装记录只描述来源与版本，
 * 不参与运行期路径解析。没有 appRoot、没有第二扫描根。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import type { WorkStudioManifest } from '@workstudio/sdk';
import type { StorageLayout } from '../platform/paths.ts';
import { readJson, writeJson } from '../platform/json.ts';
import type { PluginPackage } from './manifest.ts';

export interface InstalledPluginRecord {
  id: string;
  version: string;
  source: 'builtin' | 'zip' | 'local' | 'catalog';
  builtin?: boolean;
  hash?: string;
  installedAt?: number;
}

export type PluginIndex = Record<string, InstalledPluginRecord>;

export interface BuiltinPackage {
  id: string;
  /** 构建期资产目录；调用方负责提供，不从 appRoot 推导。 */
  sourceDir: string;
}

/** 安装根只暴露这三个路径。 */
export class PluginStore {
  constructor(private readonly layout: StorageLayout) {}

  ensure(): void {
    for (const path of [
      this.layout.pluginsInstalledRoot,
      this.layout.pluginsDataRoot,
      this.layout.pluginsTmpRoot,
      this.layout.pluginsStagingRoot,
      this.layout.pluginsRecoveryRoot,
    ]) {
      mkdirSync(path, { recursive: true });
    }
  }

  installedRoot(): string {
    return this.layout.pluginsInstalledRoot;
  }

  dataRootOf(pluginId: string): string {
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

  index(): PluginIndex {
    const raw = readJson(this.layout.pluginsIndexFile);
    const result: PluginIndex = {};
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value !== 'object' || value === null) continue;
      const record = value as Partial<InstalledPluginRecord>;
      if (!record.id || !record.version || !record.source) continue;
      result[id] = {
        id: record.id,
        version: record.version,
        source: record.source,
        ...(record.builtin ? { builtin: true } : {}),
        ...(record.hash ? { hash: record.hash } : {}),
        ...(record.installedAt ? { installedAt: record.installedAt } : {}),
      };
    }
    return result;
  }

  writeIndex(index: PluginIndex): void {
    writeJson(this.layout.pluginsIndexFile, index);
  }

  /** 扫描 installed；清单无效的目录跳过，由诊断域展示。 */
  list(): PluginPackage[] {
    this.ensure();
    const result: PluginPackage[] = [];
    for (const id of readdirSync(this.layout.pluginsInstalledRoot)) {
      const pkg = this.read(id);
      if (pkg) result.push(pkg);
    }
    return result;
  }

  read(pluginId: string): PluginPackage | null {
    return this.readAt(join(this.layout.pluginsInstalledRoot, pluginId));
  }

  /** 安装本地目录：复制进 installed，保留 plugins/data。 */
  installDirectory(
    sourceDir: string,
    sourceType: 'local' | 'zip' = 'local',
    hash?: string,
  ): PluginPackage {
    this.ensure();
    if (!statSync(sourceDir).isDirectory()) {
      throw new Error('插件来源必须是目录');
    }
    const pkg = this.readAt(sourceDir);
    if (!pkg) throw new Error('插件清单无效');
    const id = pkg.manifest.id;
    const staging = join(this.layout.pluginsStagingRoot, `${id}.install`);
    const target = join(this.layout.pluginsInstalledRoot, id);
    rmSync(staging, { recursive: true, force: true });
    cpSync(sourceDir, staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(staging, target, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    const index = this.index();
    index[id] = {
      id,
      version: readVersion(target),
      source: sourceType,
      ...(hash ? { hash } : {}),
      installedAt: Date.now(),
    };
    this.writeIndex(index);
    const installed = this.read(id);
    if (!installed) throw new Error(`插件安装后不可读：${id}`);
    return installed;
  }

  private readAt(root: string): PluginPackage | null {
    const manifest = readManifest(root);
    if (!manifest) return null;
    const entry = resolveExport(root, manifest, './workstudio');
    const contentPage = resolveRelative(root, manifest.pages?.content);
    if (!entry || !contentPage) return null;
    if (!existsSync(entry) || !existsSync(contentPage)) return null;
    const settingsPage = resolveRelative(root, manifest.pages?.settings);
    if (settingsPage && !existsSync(settingsPage)) return null;
    const version = readVersion(root);
    return {
      manifest,
      version,
      root,
      entry,
      contentPage,
      ...(settingsPage ? { settingsPage } : {}),
    };
  }

  /** 内置包播种：同版本跳过，新版本替换包体，保留 plugins/data。 */
  seedBuiltin(builtin: BuiltinPackage): boolean {
    this.ensure();
    const target = join(this.layout.pluginsInstalledRoot, builtin.id);
    const index = this.index();
    const current = index[builtin.id];
    if (
      current?.builtin &&
      current.version === readVersion(builtin.sourceDir)
    ) {
      return false;
    }
    const staging = join(this.layout.pluginsStagingRoot, `${builtin.id}.seed`);
    rmSync(staging, { recursive: true, force: true });
    cpSync(builtin.sourceDir, staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(staging, target, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    index[builtin.id] = {
      id: builtin.id,
      version: readVersion(target),
      source: 'builtin',
      builtin: true,
      installedAt: Date.now(),
    };
    this.writeIndex(index);
    return true;
  }

  /** zip 先解到 staging，再走统一目录安装。 */
  installZip(bytes: Uint8Array): PluginPackage {
    this.ensure();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const staging = join(this.layout.pluginsStagingRoot, `zip-${Date.now()}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    try {
      const files = unzipSync(bytes);
      for (const [name, data] of Object.entries(files)) {
        const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
        if (
          !normalized ||
          normalized.endsWith('/') ||
          normalized.startsWith('/') ||
          normalized.includes('..')
        ) {
          continue;
        }
        const file = join(staging, normalized);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, data);
      }
      const root = findPackageRoot(staging);
      if (!root) throw new Error('zip 中缺少 package.json');
      return this.installDirectory(root, 'zip', hash);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  remove(pluginId: string, removeData = true): void {
    rmSync(join(this.layout.pluginsInstalledRoot, pluginId), {
      recursive: true,
      force: true,
    });
    rmSync(this.tempDirOf(pluginId), { recursive: true, force: true });
    if (removeData) {
      rmSync(this.dataRootOf(pluginId), { recursive: true, force: true });
    }
    const index = this.index();
    delete index[pluginId];
    this.writeIndex(index);
  }
}

function readManifest(root: string): WorkStudioManifest | null {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf-8')) as {
      workstudio?: unknown;
      workStudio?: unknown;
    };
    const raw = pkg.workstudio ?? pkg.workStudio;
    if (typeof raw !== 'object' || raw === null) return null;
    const manifest = raw as WorkStudioManifest;
    if (typeof manifest.id !== 'string' || !manifest.id) return null;
    return manifest;
  } catch {
    return null;
  }
}

function readVersion(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf-8'),
    ) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function resolveExport(
  root: string,
  manifest: WorkStudioManifest,
  key: string,
): string | null {
  const file = join(root, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf-8')) as {
      exports?: string | Record<string, unknown>;
    };
    const value = pkg.exports;
    if (typeof value === 'string') return resolveRelative(root, value);
    const entry = value?.[key] ?? value?.[key.replace('./', '')];
    if (typeof entry === 'string') return resolveRelative(root, entry);
    if (typeof entry === 'object' && entry !== null) {
      const fallback = (entry as { default?: unknown }).default;
      if (typeof fallback === 'string') return resolveRelative(root, fallback);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveRelative(root: string, value?: string): string | null {
  if (!value) return null;
  return join(root, value);
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
