/**
 * 数据根解析（architecture.md §2.6）。
 *
 * 优先级：`--data-dir=` → `WA_DATA_DIR` → 指针文件 → 便携目录 → 系统默认位置。
 *
 * 指针文件固定放在**系统默认位置**（`appData/<产品名>/data-root.json`），
 * 不随数据根移动——否则改了根就再也找不到「用户选了哪个根」。
 * 解析完成后立即 `app.setPath('userData', root)`：Chromium 缓存、日志、
 * 单实例锁与应用数据落在同一根下。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const POINTER_FILE = 'data-root.json';

export type DataRootSource =
  | 'flag'
  | 'env'
  | 'pointer'
  | 'portable'
  | 'default';

export interface DataRootInfo {
  readonly root: string;
  readonly source: DataRootSource;
}

let resolved: DataRootInfo | null = null;

/** 系统默认位置（Electron 的 userData 默认值；setPath 之前调用才是默认值）。 */
export function defaultDataRoot(): string {
  return path.join(app.getPath('appData'), app.getName());
}

/** 指针文件：记录用户选择的根，始终位于默认位置下。 */
export function dataRootPointerFile(): string {
  return path.join(defaultDataRoot(), POINTER_FILE);
}

/** 解析并应用数据根（幂等；必须在写任何数据文件之前调用）。 */
export function initDataRoot(): DataRootInfo {
  if (resolved) return resolved;
  const info = resolveDataRoot();
  mkdirSync(info.root, { recursive: true });
  app.setPath('userData', info.root);
  resolved = info;
  return info;
}

/** 已解析的数据根（未初始化则抛错，避免静默落到错误目录）。 */
export function getDataRoot(): string {
  if (!resolved)
    throw new Error('dataRoot not initialized — call initDataRoot() at boot');
  return resolved.root;
}

export function getDataRootSource(): DataRootSource {
  return resolved?.source ?? 'default';
}

/** 用户更改数据根：只写指针，由调用方重启应用生效。 */
export function setDataRoot(next: string): void {
  const file = dataRootPointerFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ root: path.resolve(next) }, null, 2)}\n`,
    'utf-8',
  );
}

function resolveDataRoot(): DataRootInfo {
  const fromFlag = argvDataDir();
  if (fromFlag) return { root: path.resolve(fromFlag), source: 'flag' };

  const fromEnv = process.env['WA_DATA_DIR'];
  if (fromEnv) return { root: path.resolve(fromEnv), source: 'env' };

  const fromPointer = readPointer();
  if (fromPointer) return { root: fromPointer, source: 'pointer' };

  const portable = path.join(path.dirname(app.getPath('exe')), 'data');
  if (existsSync(portable)) return { root: portable, source: 'portable' };

  return { root: defaultDataRoot(), source: 'default' };
}

function argvDataDir(): string | null {
  const argv = process.argv;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('--data-dir=')) return arg.slice('--data-dir='.length);
    if (arg === '--data-dir') return argv[index + 1] ?? null;
  }
  return null;
}

function readPointer(): string | null {
  try {
    const raw = JSON.parse(readFileSync(dataRootPointerFile(), 'utf-8')) as {
      root?: unknown;
    };
    return typeof raw.root === 'string' && path.isAbsolute(raw.root)
      ? raw.root
      : null;
  } catch {
    return null;
  }
}
