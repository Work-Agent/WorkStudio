/**
 * AppSpaceSettingsStorage —— pi SettingsManager 的 App 空间存储（agent-design.md §八）。
 *
 * pi 的 settings 分层：global 落 <agentDir>/settings.json；project 层默认落项目内
 * .pi/settings.json。我们把 project 层搬到 App 空间（<agentDir>/ws/<wsId>/settings.json），
 * 与 sessions 同构：工作区隔离、不污染用户项目目录。
 *
 * 契约：SettingsStorage.withLock(scope, fn) —— fn 收到当前文件文本，返回新文本则写回。
 * 写入为原子替换（tmp → rename）。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname } from 'path';
/** pi SettingsStorage 的结构契约（包根未导出类型，按声明结构实现）。 */
export type SettingsScope = 'global' | 'project';
export interface SettingsStorageLike {
  withLock(
    scope: SettingsScope,
    fn: (current: string | undefined) => string | undefined,
  ): void;
}

export class AppSpaceSettingsStorage implements SettingsStorageLike {
  constructor(
    readonly globalFile: string,
    readonly projectFile: string,
  ) {}

  withLock(
    scope: SettingsScope,
    fn: (current: string | undefined) => string | undefined,
  ): void {
    const file = scope === 'global' ? this.globalFile : this.projectFile;
    const current = existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
    const next = fn(current);
    if (next === undefined) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, next, 'utf-8');
    renameSync(tmp, file);
  }
}

/** 读取 JSON 文件（缺失 / 损坏返回空对象）。 */
export function readJsonFile<T = Record<string, unknown>>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return {} as T;
  }
}
