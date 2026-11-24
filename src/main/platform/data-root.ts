/**
 * 数据根解析：纯函数只接受外部注入的路径，不依赖 Electron。
 *
 * 优先级与旧版一致：--data-dir → WA_DATA_DIR → 指针文件 → 便携目录 → 默认。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export type DataRootSource =
  | 'flag'
  | 'env'
  | 'pointer'
  | 'portable'
  | 'default';

export interface DataRootInfo {
  root: string;
  source: DataRootSource;
}

export interface DataRootInputs {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  pointerFile: string;
  portableRoot?: string;
  defaultRoot: string;
}

export function resolveDataRoot(inputs: DataRootInputs): DataRootInfo {
  const fromFlag = argvDataDir(inputs.argv ?? process.argv);
  if (fromFlag) return { root: resolve(fromFlag), source: 'flag' };

  const fromEnv = (inputs.env ?? process.env)['WA_DATA_DIR'];
  if (fromEnv) return { root: resolve(fromEnv), source: 'env' };

  const fromPointer = readPointer(inputs.pointerFile);
  if (fromPointer) return { root: fromPointer, source: 'pointer' };

  if (inputs.portableRoot && existsSync(inputs.portableRoot)) {
    return { root: resolve(inputs.portableRoot), source: 'portable' };
  }

  return { root: resolve(inputs.defaultRoot), source: 'default' };
}

export function setDataRoot(pointerFile: string, next: string): void {
  mkdirSync(dirname(pointerFile), { recursive: true });
  writeFileSync(
    pointerFile,
    `${JSON.stringify({ root: resolve(next) }, null, 2)}\n`,
    'utf-8',
  );
}

export function dataRootPointerFile(profileDir: string): string {
  return resolve(profileDir, 'data-root.json');
}

function readPointer(file: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { root?: unknown };
    return typeof raw.root === 'string' && isAbsolute(raw.root)
      ? raw.root
      : null;
  } catch {
    return null;
  }
}

function argvDataDir(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('--data-dir=')) return arg.slice('--data-dir='.length);
    if (arg === '--data-dir') return argv[index + 1] ?? null;
  }
  return null;
}
