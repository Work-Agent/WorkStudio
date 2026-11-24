/**
 * 主进程 JSON 读写：只处理命名空间与原子写入，不解释业务字段。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function readJson(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(temp, file);
}

export function readNamespace(
  file: string,
  namespace: string,
): Record<string, unknown> {
  const value = readJson(file)[namespace];
  return isRecord(value) ? value : {};
}

export function writeNamespace(
  file: string,
  namespace: string,
  patch: Record<string, unknown>,
): void {
  const current = readJson(file);
  const previous = isRecord(current[namespace]) ? current[namespace] : {};
  writeJson(file, {
    ...current,
    [namespace]: { ...previous, ...patch },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}
