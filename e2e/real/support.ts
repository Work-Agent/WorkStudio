/** 真实模型用例的共享准备：读取 WorkStudio 自身的数据根并复制到隔离目录。 */

import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

interface Settings {
  defaultProvider?: unknown;
  defaultModel?: unknown;
}

export function workStudioDataRoot(): string {
  if (process.env['WA_DATA_DIR']) return process.env['WA_DATA_DIR'];
  if (process.platform === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'WorkStudio',
      'data',
    );
  }
  if (process.platform === 'win32') {
    return join(
      process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
      'WorkStudio',
      'data',
    );
  }
  return join(
    process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'),
    'WorkStudio',
    'data',
  );
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function configuredModel(
  root: string,
): { provider: string; model: string } | null {
  const auth = readJson<Record<string, { key?: string }>>(
    join(root, 'auth.json'),
  );
  const models = readJson<{ providers?: Record<string, unknown> }>(
    join(root, 'models.json'),
  );
  const settings = readJson<Settings>(join(root, 'settings.json'));
  if (!auth || !models || !settings) return null;
  const provider = settings.defaultProvider;
  const model = settings.defaultModel;
  if (typeof provider !== 'string' || typeof model !== 'string') return null;
  if (!auth[provider]?.key) return null;
  return { provider, model };
}

export function prepareDataDir(sourceRoot: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'work-studio-real-'));
  cpSync(join(sourceRoot, 'auth.json'), join(dataDir, 'auth.json'));
  if (existsSync(join(sourceRoot, 'models.json'))) {
    cpSync(join(sourceRoot, 'models.json'), join(dataDir, 'models.json'));
  }
  cpSync(join(sourceRoot, 'settings.json'), join(dataDir, 'settings.json'));
  return dataDir;
}
