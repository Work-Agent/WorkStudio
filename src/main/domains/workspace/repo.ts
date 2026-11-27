/**
 * 工作区注册表：目录自描述，当前工作区只记在 windows.json。
 *
 * 目录布局与旧数据兼容：
 *   workspaces/<wsId>/workspace.json
 *   workspaces/<wsId>/sessions/
 *   workspaces/<wsId>/settings.json
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import type { WorkspaceMeta } from '../../../shared/app.ts';
import type { StorageLayout } from '../../platform/paths.ts';
import {
  readWindowState,
  writeWindowState,
} from '../../platform/window-state.ts';

interface WorkspaceFile {
  path: string;
  name?: string;
  createdAt?: number;
  lastOpenedAt?: number;
}

export class WorkspaceRepository {
  constructor(
    private readonly layout: StorageLayout,
    private readonly defaultWorkspacePath?: string,
  ) {}

  /** 应用管理的站点快照目录。 */
  sitesDir(workspaceId: string): string {
    return this.layout.sitesDir(workspaceId);
  }

  list(): WorkspaceMeta[] {
    const root = this.layout.workspacesRoot;
    if (!existsSync(root)) return [];
    const result: WorkspaceMeta[] = [];
    for (const id of readdirSync(root)) {
      const meta = this.metaOf(id);
      // 文件系统根不是工作区：安装包首次启动时 cwd 是 `/`，不能把它记成工作区。
      if (meta && !isFilesystemRoot(meta.path)) result.push(meta);
    }
    return result.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  restore(): WorkspaceMeta | null {
    const currentId = readWindowState(this.layout).workspaceId;
    const workspaces = this.list();
    const current = currentId
      ? (workspaces.find((workspace) => workspace.id === currentId) ?? null)
      : null;
    if (current && current.exists) return current;
    const existing = workspaces.find((workspace) => workspace.exists);
    if (existing) return existing;
    if (!this.defaultWorkspacePath) return null;
    try {
      return this.register(this.defaultWorkspacePath);
    } catch {
      return null;
    }
  }

  find(id: string): WorkspaceMeta | null {
    return this.metaOf(id);
  }

  register(path: string): WorkspaceMeta {
    if (isFilesystemRoot(path))
      throw new Error('不能把文件系统根目录作为工作区');
    if (!isDirectory(path)) throw new Error('工作区目录不存在或不可访问');
    const id = workspaceIdOf(path);
    const base = this.layout.workspaceBase(id);
    const file = join(base, 'workspace.json');
    const previous = readWorkspaceFile(file);
    const now = Date.now();
    const meta = {
      path,
      name: previous?.name || basename(path) || path,
      createdAt: previous?.createdAt ?? now,
      lastOpenedAt: now,
    };
    mkdirSync(this.layout.sessionsDir(id), { recursive: true });
    writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
    return this.toView(id, meta);
  }

  rename(id: string, name: string): WorkspaceMeta | null {
    const file = this.fileOf(id);
    const current = readWorkspaceFile(file);
    if (!current) return null;
    const next = { ...current, name };
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    return this.toView(id, next);
  }

  remove(id: string): void {
    rmSync(this.layout.workspaceBase(id), { recursive: true, force: true });
    if (readWindowState(this.layout).workspaceId === id) {
      writeWindowState(this.layout, { workspaceId: null });
    }
  }

  writeCurrent(id: string | null): void {
    writeWindowState(this.layout, { workspaceId: id });
  }

  private metaOf(id: string): WorkspaceMeta | null {
    const raw = readWorkspaceFile(this.fileOf(id));
    if (!raw || typeof raw.path !== 'string') return null;
    return this.toView(id, raw);
  }

  private toView(id: string, raw: WorkspaceFile): WorkspaceMeta {
    const now = Date.now();
    return {
      id,
      path: raw.path,
      name: raw.name || basename(raw.path) || raw.path,
      createdAt: raw.createdAt ?? now,
      lastOpenedAt: raw.lastOpenedAt ?? now,
      exists: isDirectory(raw.path),
    };
  }

  private fileOf(id: string): string {
    return join(this.layout.workspaceBase(id), 'workspace.json');
  }
}

/** 根目录（`/`、`C:\\`）不是工作区：枚举它既无意义也没权限。 */
export function isFilesystemRoot(path: string): boolean {
  const normalized = resolve(path);
  return dirname(normalized) === normalized;
}

export function workspaceIdOf(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12);
}

function readWorkspaceFile(file: string): WorkspaceFile | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value['path'] !== 'string') return null;
    return {
      path: value['path'],
      ...(typeof value['name'] === 'string' ? { name: value['name'] } : {}),
      ...(typeof value['createdAt'] === 'number'
        ? { createdAt: value['createdAt'] }
        : {}),
      ...(typeof value['lastOpenedAt'] === 'number'
        ? { lastOpenedAt: value['lastOpenedAt'] }
        : {}),
    };
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
