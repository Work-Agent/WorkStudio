/**
 * 数据根解析（architecture.md §2.6）。
 *
 * 优先级：`--data-dir=` → `WA_DATA_DIR` → 指针文件 → 便携目录 → 系统默认位置。
 *
 * 目录分层（profile 根 = `appData/<产品名>`）：
 *   <profile>/data/       应用数据根（pi 的 agent dir + 工作区，默认值）
 *   <profile>/chromium/   Chromium 会话数据（缓存 / Cookies / 分区存储）
 *   <profile>/data-root.json  指针：用户选择的根，必须在数据根之外
 *
 * 不把 `userData` 指到数据根：那会让 Chromium 的文件落进数据根，与
 * pi 的配置、工作区现场混在一处。
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

/** profile 根：平台给本应用的 appData 目录。 */
export function profileDir(): string {
  return path.join(app.getPath('appData'), app.getName());
}

/** 默认数据根：profile 下的 data/。 */
export function defaultDataRoot(): string {
  return path.join(profileDir(), 'data');
}

/** Chromium 会话数据目录：与数据根并列，不混入应用数据。 */
export function chromiumDataDir(): string {
  return path.join(profileDir(), 'chromium');
}

/** 指针文件：记录用户选择的根，固定在 profile 根下（数据根之外）。 */
export function dataRootPointerFile(): string {
  return path.join(profileDir(), POINTER_FILE);
}

/** 解析并应用数据根（幂等；必须在写任何数据文件之前调用）。 */
export function initDataRoot(): DataRootInfo {
  const info = resolveDataRoot();
  mkdirSync(info.root, { recursive: true });
  // Chromium 会话数据单独收拢：数据根里只留应用自己的东西
  app.setPath('sessionData', chromiumDataDir());
  return info;
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
