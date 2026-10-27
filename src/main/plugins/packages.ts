// ─── 插件包（package.json 清单） ─────────────────────────────────────
//
// 插件就是 npm 包：清单字段与代码入口都在 package.json，没有单独的 manifest.json。
// 一个插件最多两个页面：page（渲染器）+ 可选 settings（设置页）。

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

export interface WorkStudioManifest {
  id?: string;
  label?: string;
  /** 图标语义名（壳层映射）。 */
  icon?: string;
  /** 渲染器页。 */
  page?: string;
  /** 设置页（可选）。 */
  settings?: string;
  webAccessible?: string[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  exports?: string | Record<string, unknown>;
  workstudio?: WorkStudioManifest;
}

export interface PluginPackage {
  id: string;
  name: string;
  /** 展示名。 */
  label: string;
  /** 图标语义名。 */
  icon?: string;
  version: string;
  description?: string;
  author?: string;
  root: string;
  /** 渲染器页（绝对路径）。 */
  page?: string;
  /** 设置页（绝对路径）。 */
  settings?: string;
  /** 自定义图标（favicon 格式，data: URL）。 */
  iconUrl?: string;
  /** 注册入口（绝对路径）。 */
  uraEntry?: string;
}

export async function scanPluginPackages(
  roots: string[],
): Promise<PluginPackage[]> {
  const packages: PluginPackage[] = [];
  const seen = new Set<string>();
  const consider = async (packageRoot: string, dirName: string) => {
    const manifest = await readPackage(packageRoot, dirName);
    if (!manifest || seen.has(manifest.id)) return;
    seen.add(manifest.id);
    packages.push(manifest);
  };
  for (const root of roots) {
    // 本地来源本身就是插件目录（不必是父级扫描根）。
    const self = await readFile(join(root, 'package.json'), 'utf-8').catch(
      () => null,
    );
    if (self) await consider(root, basename(root));
    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => null,
    );
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.bin') continue;
      if (entry.name.startsWith('@')) {
        // npm 安装目录：@scope/<pkg>
        const scoped = await readdir(join(root, entry.name), {
          withFileTypes: true,
        }).catch(() => null);
        if (!scoped) continue;
        for (const sub of scoped) {
          if (!sub.isDirectory()) continue;
          await consider(join(root, entry.name, sub.name), sub.name);
        }
        continue;
      }
      await consider(join(root, entry.name), entry.name);
    }
  }
  return packages;
}

async function readPackage(
  root: string,
  dirName: string,
): Promise<PluginPackage | null> {
  const raw = await readFile(join(root, 'package.json'), 'utf-8').catch(
    () => null,
  );
  if (!raw) return null;
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
  const workstudio = pkg.workstudio;
  if (!workstudio) return null;

  const id = workstudio.id ?? pkg.name ?? dirName;
  const page = await resolveFile(root, workstudio.page);
  const settingsPage = await resolveFile(root, workstudio.settings);
  const iconRaw = workstudio.icon;
  const iconFile =
    iconRaw && /\.(svg|png|ico|jpe?g|webp|gif)$/i.test(iconRaw)
      ? await resolveFile(root, iconRaw)
      : undefined;
  const iconUrl = iconFile ? await dataUrl(iconFile) : undefined;
  return {
    id,
    name: pkg.name ?? id,
    label: workstudio.label ?? pkg.name ?? id,
    ...(iconFile ? { iconUrl } : {}),
    ...(!iconFile && workstudio.icon ? { icon: workstudio.icon } : {}),
    version: pkg.version ?? '0.0.0',
    description: pkg.description,
    author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name,
    root,
    page,
    settings: settingsPage,
    uraEntry: await resolveFile(root, exportPath(pkg.exports, './ura')),
  };
}

const ICON_MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

async function dataUrl(file: string): Promise<string> {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  const mime = ICON_MIME[ext] ?? 'application/octet-stream';
  const bytes = await readFile(file);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function exportPath(
  exportsField: PackageJson['exports'],
  key: string,
): string | undefined {
  if (!exportsField) return undefined;
  if (typeof exportsField === 'string') return exportsField;
  const value = exportsField[key] ?? exportsField[key.replace('./', '')];
  if (typeof value === 'string') return value;
  const nested = (value as Record<string, string> | undefined)?.default;
  return typeof nested === 'string' ? nested : undefined;
}

async function resolveFile(
  root: string,
  relative: string | undefined,
): Promise<string | undefined> {
  if (!relative) return undefined;
  const absolute = isAbsolute(relative) ? relative : join(root, relative);
  const info = await stat(absolute).catch(() => null);
  return info?.isFile() ? absolute : undefined;
}
